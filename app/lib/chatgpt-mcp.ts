import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { fetchEuMoney, renderEuMoneyEntities, searchEuMoney } from "./chatgpt-mcp-data";
import { euFundingImportMetadata, euFundingSourceUpdatedIso } from "../../lib/eu-funding";

const RESULTS_WIDGET_URI = "ui://eu-money/results-v1.html";
const WIDGET_DOMAIN = "https://chatgpt.eumoney.hu";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
} as const;

const resultsWidgetHtml = String.raw`<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root{color-scheme:light dark;--paper:#fbfaf5;--ink:#143e38;--muted:#5d756e;--line:#d9ddd3;--lime:#cdea55;--gold:#dfb954;--soft:#eef4df}
    *{box-sizing:border-box}body{margin:0;background:transparent;color:var(--ink);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{display:grid;gap:10px;padding:2px}.empty{padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
    article{overflow:hidden;border:1px solid var(--line);border-left:4px solid var(--lime);border-radius:14px;background:var(--paper);box-shadow:0 5px 18px rgba(20,62,56,.07)}
    .body{padding:14px 15px 12px}.meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.tag{padding:3px 8px;border-radius:999px;background:var(--soft);color:var(--ink);font-size:11px;font-weight:750;letter-spacing:.02em}
    h2{margin:0 0 6px;font:700 19px/1.2 ui-serif,Georgia,serif}p{margin:0;color:var(--muted)}a{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 15px;border-top:1px solid var(--line);color:var(--ink);font-weight:750;text-decoration:none}a span{color:var(--gold)}a:hover{text-decoration:underline}
    @media(prefers-color-scheme:dark){:root{--paper:#162b27;--ink:#eff7f2;--muted:#b8cbc5;--line:#3a534c;--soft:#29413a}article{box-shadow:none}}
  </style>
</head>
<body>
  <main id="results"><div class="empty">Az EU Money találatai betöltődnek…</div></main>
  <script>
    const root=document.getElementById("results");
    const escapeHtml=(value)=>String(value||"").replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
    function render(payload){
      const value=payload&&payload.structuredContent?payload.structuredContent:payload;
      if(!value||!Array.isArray(value.items))return;
      const items=value.items;
      if(!items.length){root.innerHTML='<div class="empty">Nincs megjeleníthető EU Money-találat.</div>';return}
      root.innerHTML=items.map((item)=>{
        const tags=[item.status,item.amount,item.deadline,item.topic].filter(Boolean).map((tag)=>'<span class="tag">'+escapeHtml(tag)+'</span>').join("");
        return '<article><div class="body"><div class="meta">'+tags+'</div><h2>'+escapeHtml(item.title)+'</h2><p>'+escapeHtml(item.summary||item.subtitle)+'</p></div><a href="'+escapeHtml(item.url)+'" target="_blank" rel="noreferrer">EU Money-adatlap megnyitása <span aria-hidden="true">→</span></a></article>';
      }).join("");
    }
    if(window.openai&&window.openai.toolOutput!==undefined)render(window.openai.toolOutput);
    window.addEventListener("openai:set_globals",(event)=>{
      const output=event.detail&&event.detail.globals&&event.detail.globals.toolOutput;
      if(output!==undefined)render(output);
    });
    const pendingRequests=new Map();
    let nextRequestId=1;
    function request(method,params){
      const id=nextRequestId++;
      window.parent.postMessage({jsonrpc:"2.0",id,method,params},"*");
      return new Promise((resolve,reject)=>pendingRequests.set(id,{resolve,reject}));
    }
    window.addEventListener("message",(event)=>{
      if(event.source!==window.parent)return;
      const message=event&&event.data;
      if(!message||message.jsonrpc!=="2.0")return;
      if(message.id!==undefined&&pendingRequests.has(message.id)){
        const pending=pendingRequests.get(message.id);
        pendingRequests.delete(message.id);
        if(message.error)pending.reject(message.error);else pending.resolve(message.result);
        return;
      }
      if(message.method==="ui/notifications/tool-result"&&message.params&&message.params.structuredContent!==undefined)render(message.params);
    },{passive:true});
    request("ui/initialize",{
      appInfo:{name:"eu-money-results",version:"1.0.0"},
      appCapabilities:{},
      protocolVersion:"2026-01-26"
    }).then(()=>window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*")).catch(()=>{});
  </script>
</body>
</html>`;

function createEuMoneyServer() {
  const server = new McpServer({
    name: "EU Money",
    version: "1.0.1",
  }, {
    instructions: "Use EU Money for current and planned Hungarian EU funding opportunities, eligibility conditions, deadlines, support amounts, preparation guidance, thematic outlooks and practical grant knowledge. Search first, then fetch relevant IDs. Cite canonical URLs. Clearly distinguish official-source facts, draft information and EU Money explanatory analysis. Never infer eligibility or funding certainty from missing data.",
  });

  server.registerTool("search", {
    title: "Keresés az EU Moneyban",
    description: "Use this when the user wants to find current or planned Hungarian EU funding opportunities, grant topics, eligibility guidance or EU Money knowledge articles. Call search before fetch when you do not already have an EU Money entity ID.",
    inputSchema: { query: z.string().min(2).max(300).describe("Natural-language search query in Hungarian or English") },
    outputSchema: {
      results: z.array(z.object({
        id: z.string(),
        title: z.string(),
        url: z.string().url(),
        text: z.string().optional(),
      })),
    },
    annotations: readOnlyAnnotations,
  }, async ({ query }) => {
    const results = await searchEuMoney(query);
    const payload = { results };
    return { structuredContent: payload, content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
  });

  server.registerTool("fetch", {
    title: "EU Money-adatlap lekérése",
    description: "Use this after search to retrieve one complete, citation-ready EU Money grant, draft, topic or knowledge record by ID. It returns structured source facts plus clearly identified explanatory guidance.",
    inputSchema: { id: z.string().min(3).max(500).describe("ID returned by search, such as grant:…, planned:…, topic:… or article:…") },
    outputSchema: {
      id: z.string(),
      title: z.string(),
      text: z.string(),
      url: z.string().url(),
      metadata: z.record(z.unknown()),
    },
    annotations: readOnlyAnnotations,
  }, async ({ id }) => {
    const entity = await fetchEuMoney(id);
    if (!entity) return { isError: true, content: [{ type: "text" as const, text: `Nincs ilyen nyilvános EU Money-rekord: ${id}` }] };
    const payload = { id: entity.id, title: entity.title, text: entity.text, url: entity.url, metadata: entity.metadata };
    return { structuredContent: payload, content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
  });

  registerAppTool(server, "render_results", {
    title: "EU Money-találatok megjelenítése",
    description: "Use this when one or more EU Money IDs have already been selected and the user wants compact interactive cards. It does not search, submit an application or change any data.",
    inputSchema: { ids: z.array(z.string().min(3).max(500)).min(1).max(10).describe("IDs returned by search") },
    outputSchema: {
      items: z.array(z.object({
        id: z.string(),
        type: z.enum(["grant", "planned", "topic", "article"]),
        title: z.string(),
        subtitle: z.string(),
        summary: z.string(),
        url: z.string().url(),
        status: z.string().optional(),
        amount: z.string().optional(),
        deadline: z.string().optional(),
        topic: z.string().optional(),
      })),
    },
    annotations: readOnlyAnnotations,
    _meta: {
      ui: { resourceUri: RESULTS_WIDGET_URI, visibility: ["model"] },
      "openai/outputTemplate": RESULTS_WIDGET_URI,
      "openai/toolInvocation/invoking": "EU Money-adatok betöltése…",
      "openai/toolInvocation/invoked": "Az EU Money-adatok megérkeztek",
    },
  }, async ({ ids }) => {
    const items = await renderEuMoneyEntities(ids);
    return {
      structuredContent: { items },
      content: [{ type: "text" as const, text: `${items.length} EU Money-adatlap megjelenítve.` }],
    };
  });

  const resourceMeta = {
    ui: {
      domain: WIDGET_DOMAIN,
      prefersBorder: true,
      csp: { connectDomains: [] as string[], resourceDomains: [] as string[] },
    },
    "openai/widgetDescription": "Az EU Money kiválasztott pályázatait, tervezeteit és tudástári tartalmait tömör, hivatkozott kártyákon jeleníti meg.",
    "openai/widgetPrefersBorder": true,
    "openai/widgetDomain": WIDGET_DOMAIN,
    "openai/widgetCSP": { connect_domains: [] as string[], resource_domains: [] as string[] },
  };

  registerAppResource(server, "EU Money találati kártyák", RESULTS_WIDGET_URI, {
    description: "Read-only result cards for EU Money grants, drafts, topics and guidance.",
    _meta: resourceMeta,
  }, async () => ({
    contents: [{
      uri: RESULTS_WIDGET_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: resultsWidgetHtml,
      _meta: resourceMeta,
    }],
  }));

  return server;
}

function withMcpCors(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  headers.set("Access-Control-Expose-Headers", "MCP-Session-Id, MCP-Protocol-Version");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function euMoneyMcpOptionsResponse() {
  return withMcpCors(new Response(null, { status: 204 }));
}

export function euMoneyMcpHealthResponse() {
  return Response.json({ status: "ok", name: "EU Money", protocol: "MCP Streamable HTTP", dataSource: euFundingImportMetadata ? "official-api-snapshot" : "verified-snapshot", sourceUpdatedAt: euFundingSourceUpdatedIso, sourceCount: euFundingImportMetadata?.sourceTotal ?? null }, {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function handleEuMoneyMcpRequest(request: Request) {
  const server = createEuMoneyServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return withMcpCors(await transport.handleRequest(request));
}
