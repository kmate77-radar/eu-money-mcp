# EU Money MCP interface

Production MCP interface source for [EU Money](https://eumoney.hu), a Hungarian and European funding information service by Mayer Advisory.

## Connect to the hosted service

- Streamable HTTP endpoint: `https://eumoney.hu/chatgpt/mcp`
- Registry name: `hu.eumoney/eu-money`
- Public descriptor: [server.json](https://eumoney.hu/server.json)
- Integration guide: [AI integrations](https://eumoney.hu/ai-integraciok)

The hosted interface offers three read-only tools:

| Tool | Purpose |
| --- | --- |
| `search` | Find current and planned funding opportunities, funding topics and guidance. |
| `fetch` | Retrieve one complete, citation-ready public EU Money record. |
| `render_results` | Display selected records as linked result cards. |

No local installation or API key is required to connect to the hosted endpoint.

## Scope of this repository

This repository contains the actual production MCP interface: Streamable HTTP transport, tool definitions, input/output schemas, read-only annotations, result widget, search and ranking logic, entity fetching and serialization.

It is an auditable source snapshot of the MCP component. It is not a standalone distribution of the complete EU Money website. The hosted service imports separately maintained grant catalogues, editorial content and funding snapshots; those datasets and the rest of the web application are not included.

## Source files and dependencies

- `app/lib/chatgpt-mcp.ts`: MCP transport, tools, result widget and HTTP request handling.
- `app/lib/chatgpt-mcp-data.ts`: search, entity retrieval, canonical links and result-card serialization. Includes the `EuMoneySearchResult`, `EuMoneyFetchedEntity` and `EuMoneyEntityCard` types.
- `server.json`: official MCP Registry descriptor.

The production code uses `@modelcontextprotocol/sdk` 1.30.0, `@modelcontextprotocol/ext-apps` 1.7.5 and Zod 3.25.76. The separately maintained catalogue modules are:

| Module | Contract |
| --- | --- |
| `lib/grants.ts` | Current and planned grant records, `findGrantPage`, `getCurrentGrants`, `plannedGrants`, `Grant`, `PlannedGrant`. |
| `lib/direct-eu.ts` | Direct EU programmes and calls, `directEuProgrammes`, `getCurrentDirectEuCalls`, `DirectEuCall`. |
| `lib/eu-funding.ts` | Funding topics, official URLs, amount/deadline/Hungary labels, import metadata and source update dates. |
| `lib/portal.ts` | Public topic pages and knowledge articles, `findKnowledgeArticle`, `findTopic`, `knowledgeArticles`, `topics`. |

The hosted service supplies these dependencies. Running the two TypeScript modules in isolation requires equivalent catalogue modules. Connecting to the hosted MCP endpoint requires none of those local files.

## Provenance

The two TypeScript files are exact copies of the EU Money source at Sites commit `75130fb24f6b43377063a28781dd438aa56dd282` (21 November 2026), accompanying MCP Registry release `1.0.1`.

| File | SHA-256 |
| --- | --- |
| `app/lib/chatgpt-mcp.ts` | `fd2b377a9a92f00d9f5976acaab3a32c3b81df30395517cf7855f12ee8c68bcf` |
| `app/lib/chatgpt-mcp-data.ts` | `0118a4033bc182535a15bab9f45ea6b8ad7f8ada61712983d90008d7c3fa112c` |

## Rights

Publishing this source snapshot does not grant an additional open-source license.
