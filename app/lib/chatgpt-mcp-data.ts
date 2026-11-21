import { findGrantPage, getCurrentGrants, plannedGrants, type Grant, type PlannedGrant } from "../../lib/grants";
import { directEuProgrammes, getCurrentDirectEuCalls, type DirectEuCall } from "../../lib/direct-eu";
import { euFundingBudgetLabel, euFundingDeadlineLabel, euFundingHungaryNote, euFundingOfficialUrl, euFundingSourceUpdatedIso, getCurrentEuFundingTopics, type EuFundingTopic } from "../../lib/eu-funding";
import { findKnowledgeArticle, findTopic, knowledgeArticles, topics } from "../../lib/portal";

const SITE_ORIGIN = "https://eumoney.hu";
const MAX_SEARCH_RESULTS = 10;

type EntityType = "grant" | "planned" | "topic" | "article" | "direct" | "eu-topic";

export type EuMoneySearchResult = {
  id: string;
  title: string;
  url: string;
  text: string;
};

export type EuMoneyEntityCard = {
  id: string;
  type: "grant" | "planned" | "topic" | "article";
  title: string;
  subtitle: string;
  summary: string;
  url: string;
  status?: string;
  amount?: string;
  deadline?: string;
  topic?: string;
};

export type EuMoneyFetchedEntity = {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: Record<string, unknown>;
  card: EuMoneyEntityCard;
};

function cleanText(value: unknown, maximum = 1_200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function normalized(value: unknown) {
  return cleanText(value, 20_000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("hu-HU");
}

const searchStopWords = new Set(["a", "az", "es", "vagy", "van", "e", "milyen", "melyik", "mely", "keresek", "keress", "mutasd", "meg", "szamomra", "nekem", "aktualis", "legfrissebb", "legutobbi", "mostani", "nyitott", "kovetkezo", "palyazat", "palyazatok", "palyazati", "felhivas", "felhivasok", "tamogatas", "tamogatasok", "the", "and", "for"]);
function searchTokens(query: string) { return [...new Set(normalized(query).split(/[^a-z0-9]+/).filter(token => token.length > 1 && !searchStopWords.has(token)))]; }

function relevance(haystack: string, query: string) {
  const source = normalized(haystack);
  const phrase = normalized(query);
  if (!phrase) return 0;
  const code = phrase.match(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}\b/)?.[0];
  if (code) return source.split(/[^a-z0-9-]+/).includes(code) ? 10_000 : 0;
  const sourceWords = source.split(/[^a-z0-9]+/);
  const hasToken = (token: string) => token.length <= 2 ? sourceWords.includes(token) : source.includes(token);
  if ((phrase.length > 2 && source.includes(phrase)) || (phrase.length <= 2 && sourceWords.includes(phrase))) return 1_000 + Math.max(0, 300 - source.indexOf(phrase));
  const tokens = searchTokens(query);
  const words = tokens.filter(token => !/^\d+$/.test(token));
  if (words.length && !words.some(hasToken)) return 0;
  const matched = tokens.filter(hasToken).length;
  return matched >= Math.ceil(tokens.length * 0.6) ? matched * 80 : 0;
}

function grantUrl(id: string) {
  return `${SITE_ORIGIN}/palyazat/${encodeURIComponent(id)}`;
}

function currentGrantCard(grant: Grant): EuMoneyEntityCard {
  return {
    id: `grant:${grant.id}`,
    type: "grant",
    title: grant.title,
    subtitle: `${grant.code} · ${grant.audience}`,
    summary: grant.summary,
    url: grantUrl(grant.id),
    status: grant.badge,
    amount: grant.grantAmount || grant.amount,
    deadline: grant.deadline,
    topic: grant.topic,
  };
}

function plannedGrantCard(grant: PlannedGrant): EuMoneyEntityCard {
  return {
    id: `planned:${grant.id}`,
    type: "planned",
    title: grant.title,
    subtitle: `${grant.code} · ${grant.audience}`,
    summary: grant.summary,
    url: grantUrl(grant.id),
    status: grant.stage,
    deadline: "A végleges felhívásban várható",
    topic: "Tervezett pályázat",
  };
}

function directEuCard(call: DirectEuCall): EuMoneyEntityCard {
  const programme = directEuProgrammes.find((item) => item.id === call.programmeId);
  const status = call.status || "open";
  return {
    id: `direct:${call.id}`,
    type: "grant",
    title: call.title,
    subtitle: `${call.code} · ${programme?.shortName || call.programmeId}`,
    summary: call.summary,
    url: `${SITE_ORIGIN}/eu-palyazat/highlight-${encodeURIComponent(call.id)}`,
    status: status === "forthcoming" ? "Hamarosan nyíló, ellenőrzött" : "Nyitott, ellenőrzött",
    amount: call.budget,
    deadline: call.deadline,
    topic: call.topics.join(", "),
  };
}

function euFundingTopicCard(topic: EuFundingTopic): EuMoneyEntityCard {
  return {
    id: `eu-topic:${topic.id}`,
    type: "grant",
    title: topic.title,
    subtitle: `${topic.identifier} · ${topic.programmeName}`,
    summary: topic.callTitle || `${topic.programmeName} témakiírás`,
    url: `${SITE_ORIGIN}/eu-palyazat/${encodeURIComponent(topic.id)}`,
    status: topic.status === "open" ? "Nyitott" : "Hamarosan nyíló",
    deadline: euFundingDeadlineLabel(topic),
    amount: euFundingBudgetLabel(topic) || undefined,
    topic: topic.tags.join(", "),
  };
}

export async function searchEuMoney(queryInput: string): Promise<EuMoneySearchResult[]> {
  const query = cleanText(queryInput, 300);
  if (query.length < 2) return [];
  const latestRequest = /\b(legfrissebb|legutóbbi|aktuális|mostani|nyitott|következő)\b/i.test(query);
  const browseLatest = latestRequest && searchTokens(query).length === 0;
  const scored: Array<{ score: number; result: EuMoneySearchResult }> = [];
  const grants = getCurrentGrants();
  const directEuCalls = getCurrentDirectEuCalls();
  const euFundingTopics = getCurrentEuFundingTopics();

  grants.forEach((grant, index) => {
    const card = currentGrantCard(grant);
    const score = relevance(`${grant.code} ${grant.title} ${grant.audience} ${grant.topic} ${grant.summary} ${grant.eligible.join(" ")} ${grant.purposes.join(" ")} ${grant.deadline}`, query);
    if (!score && !browseLatest) return;
    scored.push({
      score: (latestRequest ? 3_000 - index : 3_000 + score),
      result: { id: card.id, title: card.title, url: card.url, text: `${card.subtitle}. ${card.summary}` },
    });
  });

  plannedGrants.forEach((grant, index) => {
    const card = plannedGrantCard(grant);
    const score = relevance(`${grant.code} ${grant.title} ${grant.audience} ${grant.stage} ${grant.note} ${grant.summary} ${grant.preparation.join(" ")} ${grant.uncertainties.join(" ")}`, query);
    if (!score) return;
    scored.push({
      score: 2_700 + score - index,
      result: { id: card.id, title: card.title, url: card.url, text: `${card.subtitle}. ${card.summary}` },
    });
  });

  directEuCalls.forEach((call, index) => {
    const card = directEuCard(call);
    const programme = directEuProgrammes.find((item) => item.id === call.programmeId);
    const score = relevance(`${call.code} ${call.title} ${programme?.name || ""} ${call.summary} ${call.hungaryNote} ${call.topics.join(" ")} ${call.deadline}`, query);
    if (!score && !browseLatest) return;
    scored.push({
      score: (latestRequest ? 2_950 - index : 2_950 + score),
      result: { id: card.id, title: card.title, url: card.url, text: `${card.subtitle}. ${card.summary}` },
    });
  });

  euFundingTopics.forEach((topic, index) => {
    const card = euFundingTopicCard(topic);
    const score = relevance(`${topic.identifier} ${topic.title} ${topic.callIdentifier} ${topic.callTitle} ${topic.programmeName} ${topic.programmePath.join(" ")} ${topic.actionTypes.join(" ")} ${topic.tags.join(" ")} ${topic.status}`, query);
    if (!score && !browseLatest) return;
    scored.push({
      score: (latestRequest ? 2_900 - index : 2_900 + score),
      result: { id: card.id, title: card.title, url: card.url, text: `${card.subtitle}. ${card.summary}` },
    });
  });

  topics.forEach((topic) => {
    const score = relevance(`${topic.title} ${topic.shortTitle} ${topic.lead} ${topic.signal} ${topic.outlook} ${topic.keywords.join(" ")}`, query);
    if (!score) return;
    scored.push({
      score: 2_400 + score,
      result: { id: `topic:${topic.slug}`, title: topic.title, url: `${SITE_ORIGIN}/tema/${topic.slug}`, text: topic.lead },
    });
  });

  knowledgeArticles.forEach((article) => {
    const score = relevance(`${article.category} ${article.title} ${article.lead} ${article.takeaways.join(" ")} ${article.sections.map((section) => section.title).join(" ")}`, query);
    if (!score) return;
    scored.push({
      score: 2_100 + score,
      result: { id: `article:${article.slug}`, title: article.title, url: `${SITE_ORIGIN}/tudastar/${article.slug}`, text: article.lead },
    });
  });

  return [...new Map(scored
    .sort((left, right) => right.score - left.score)
    .map(({ result }) => [result.id, result])).values()].slice(0, MAX_SEARCH_RESULTS);
}

function bullet(label: string, value: unknown) {
  const text = cleanText(value, 3_500);
  return text ? `- ${label}: ${text}` : "";
}

function fetchCurrentGrant(grant: Grant): EuMoneyFetchedEntity {
  const card = currentGrantCard(grant);
  const text = [
    `# ${grant.title}`,
    bullet("Kód", grant.code),
    bullet("Státusz", grant.badge),
    bullet("Pályázói kör", grant.audience),
    bullet("Téma", grant.topic),
    bullet("Keret", grant.amount),
    bullet("Támogatási összeg", grant.grantAmount),
    bullet("Támogatási forma", grant.form),
    bullet("Intenzitás", grant.intensity),
    bullet("Szükséges önerő", grant.ownContribution),
    bullet("Határidő", grant.deadline),
    bullet("Forrás ellenőrizve", grant.checkedAt),
    "\n## EU Money-összefoglaló",
    grant.summary,
    "\n## Ki pályázhat?",
    ...grant.eligible.map((item) => `- ${item}`),
    "\n## Mire használható?",
    ...grant.purposes.map((item) => `- ${item}`),
    "\n## Fő feltételek",
    ...grant.conditions.map((item) => `- ${item}`),
    "\n## Ellenőrizendő kizáró okok",
    ...grant.exclusions.map((item) => `- ${item}`),
    "\n## Beadási szakaszok",
    ...grant.stages.map((item) => `- ${item}`),
    "\n## Források",
    `- Hivatalos felhívás: ${grant.sourceUrl}`,
    `- Kanonikus EU Money-adatlap: ${card.url}`,
    "\nMegjegyzés: az EU Money közérthető összefoglalója nem helyettesíti a mindenkor hatályos hivatalos felhívást és mellékleteit.",
  ].filter(Boolean).join("\n");
  return {
    id: card.id,
    title: card.title,
    text: text.slice(0, 18_000),
    url: card.url,
    metadata: { type: "grant", code: grant.code, status: grant.badge, audience: grant.audience, topic: grant.topic, checkedAt: grant.checkedAt, sourceUrls: [grant.sourceUrl] },
    card,
  };
}

function fetchPlannedGrant(grant: PlannedGrant): EuMoneyFetchedEntity {
  const card = plannedGrantCard(grant);
  const text = [
    `# ${grant.title}`,
    bullet("Kód", grant.code),
    bullet("Státusz", grant.stage),
    bullet("Várható pályázói kör", grant.audience),
    bullet("Forrás ellenőrizve", grant.checkedAt),
    "\n## EU Money-összefoglaló",
    grant.summary,
    "\n## Fontos bizonytalanság",
    grant.note,
    "\n## Már most előkészíthető",
    ...grant.preparation.map((item) => `- ${item}`),
    "\n## Még nem végleges",
    ...grant.uncertainties.map((item) => `- ${item}`),
    "\n## Források",
    `- Hivatalos tervezet vagy egyeztetés: ${grant.sourceUrl}`,
    `- Kanonikus EU Money-adatlap: ${card.url}`,
    "\nMegjegyzés: ez tervezeti információ. A feltételek és beadási időpontok a végleges felhívásig változhatnak.",
  ].filter(Boolean).join("\n");
  return {
    id: card.id,
    title: card.title,
    text: text.slice(0, 18_000),
    url: card.url,
    metadata: { type: "planned", code: grant.code, status: grant.stage, audience: grant.audience, checkedAt: grant.checkedAt, sourceUrls: [grant.sourceUrl] },
    card,
  };
}

function fetchDirectEu(call: DirectEuCall): EuMoneyFetchedEntity {
  const card = directEuCard(call);
  const programme = directEuProgrammes.find((item) => item.id === call.programmeId);
  const text = [
    `# ${call.title}`,
    bullet("Kód", call.code),
    bullet("Program", programme?.name || call.programmeId),
    bullet("Állapot", card.status),
    bullet("Határidő", call.deadline),
    bullet("Keret vagy támogatás", call.budget),
    bullet("Konzorcium", call.consortium),
    bullet("Forrás közzétéve", call.sourceDate),
    bullet("Forrás ellenőrizve", call.checkedAt),
    "\n## Összefoglaló",
    call.summary,
    "\n## Magyar pályázóknak",
    call.hungaryNote,
    "\n## Témák",
    ...call.topics.map((item) => `- ${item}`),
    "\n## Hivatalos forrás",
    `- ${call.officialUrl}`,
    `- EU Money programtérkép: ${card.url}`,
    "\nMegjegyzés: a pontos jogosultság és beadási feltétel a hivatalos témakiírásban ellenőrzendő.",
  ].join("\n");
  return { id: card.id, title: card.title, text, url: card.url, metadata: { type: "direct", programme: programme?.name, status: card.status, sourceDate: call.sourceDate, checkedAt: call.checkedAt, sourceUrls: [call.officialUrl] }, card };
}

function fetchEuFundingTopic(topic: EuFundingTopic): EuMoneyFetchedEntity {
  const card = euFundingTopicCard(topic);
  const officialUrl = euFundingOfficialUrl(topic);
  const text = [
    `# ${topic.title}`,
    bullet("Kód", topic.identifier),
    bullet("Program", topic.programmeName),
    bullet("Felhívás", `${topic.callIdentifier} ${topic.callTitle}`),
    bullet("Állapot", card.status),
    bullet("Nyitás", topic.openingDate),
    bullet("Keret", euFundingBudgetLabel(topic)),
    bullet("Határidő", card.deadline),
    "\n## Programútvonal",
    ...topic.programmePath.map((item) => `- ${item}`),
    "\n## Támogatási típus",
    ...(topic.actionTypes.length ? topic.actionTypes : ["A hivatalos témakiírás szerint"]).map((item) => `- ${item}`),
    "\n## Magyar pályázóknak",
    euFundingHungaryNote(topic),
    "\n## Témacímkék",
    ...topic.tags.map((item) => `- ${item}`),
    topic.latestInfo ? `\n## Legutóbbi hivatalos közlemény\n${topic.latestInfo}` : "",
    "\n## Források",
    `- Kanonikus EU Money-adatlap: ${card.url}`,
    `- Hivatalos EU-dokumentáció: ${officialUrl}`,
    topic.submissionUrl ? `- Beadási felület: ${topic.submissionUrl}` : "",
    "\nMegjegyzés: a magyar jogosultságot és a részletes beadási feltételeket a hivatalos dokumentáció alapján kell véglegesíteni.",
  ].filter(Boolean).join("\n");
  return {
    id: card.id,
    title: card.title,
    text: text.slice(0, 18_000),
    url: card.url,
    metadata: { type: "eu-topic", code: topic.identifier, programme: topic.programmeName, status: card.status, sourceFetchedAt: euFundingSourceUpdatedIso, sourceUrls: [officialUrl, topic.submissionUrl].filter(Boolean) },
    card,
  };
}

function fetchTopicEntity(slug: string): EuMoneyFetchedEntity | null {
  const topic = findTopic(slug);
  if (!topic) return null;
  const url = `${SITE_ORIGIN}/tema/${topic.slug}`;
  const related = getCurrentGrants().filter((grant) => topic.keywords.some((keyword) => normalized(`${grant.title} ${grant.summary} ${grant.topic}`).includes(normalized(keyword)))).slice(0, 8);
  const text = [
    `# ${topic.title}`,
    topic.lead,
    bullet("Jelzés", topic.signal),
    bullet("Kilátás", topic.outlook),
    bullet("Bizonyosság", topic.confidence),
    "\n## Vezetői teendők",
    ...topic.actions.map((item) => `- ${item}`),
    "\n## Kapcsolódó pályázatok",
    ...related.map((grant) => `- ${grant.code}: ${grant.title} — ${grantUrl(grant.id)}`),
    `\nKanonikus EU Money-témaoldal: ${url}`,
  ].join("\n");
  const card: EuMoneyEntityCard = { id: `topic:${slug}`, type: "topic", title: topic.title, subtitle: topic.signal, summary: topic.lead, url, topic: topic.shortTitle };
  return { id: card.id, title: card.title, text, url, metadata: { type: "topic", confidence: topic.confidence }, card };
}

function fetchArticleEntity(slug: string): EuMoneyFetchedEntity | null {
  const article = findKnowledgeArticle(slug);
  if (!article) return null;
  const url = `${SITE_ORIGIN}/tudastar/${article.slug}`;
  const text = [
    `# ${article.title}`,
    bullet("Kategória", article.category),
    bullet("Frissítve", article.updated),
    bullet("Szerző", article.author.name),
    bullet("Forrásellenőrzés", article.sourceCheckedAt),
    article.lead,
    "\n## Fő tanulságok",
    ...article.takeaways.map((item) => `- ${item}`),
    ...article.sections.flatMap((section) => [`\n## ${section.title}`, ...section.paragraphs, ...(section.checklist?.map((item) => `- ${item}`) || [])]),
    "\n## Hivatalos források",
    ...article.sources.map(source => `- ${source.publisher}: ${source.title} — ${source.url}\n  ${source.scope}`),
    "\nAz EU Money összefoglalója; a tervezési példák és munkatervek szerkesztői javaslatok. A konkrét jogosultságot a hatályos felhívás alapján kell ellenőrizni.",
    `\nKanonikus EU Money-útmutató: ${url}`,
  ].join("\n");
  const card: EuMoneyEntityCard = { id: `article:${slug}`, type: "article", title: article.title, subtitle: `${article.category} · ${article.readTime}`, summary: article.lead, url };
  return { id: card.id, title: card.title, text: text.slice(0, 18_000), url, metadata: { type: "article", category: article.category, updated: article.updated, author: article.author.name, checkedAt: article.sourceCheckedAt, sourceUrls: article.sources.map(source => source.url) }, card };
}

export async function fetchEuMoney(idInput: string): Promise<EuMoneyFetchedEntity | null> {
  const id = cleanText(idInput, 500);
  const separator = id.indexOf(":");
  if (separator < 1) return null;
  const type = id.slice(0, separator) as EntityType;
  const rawId = id.slice(separator + 1);
  if (!rawId) return null;
  if (type === "grant") {
    const entry = findGrantPage(rawId);
    return entry?.kind === "current" ? fetchCurrentGrant(entry.grant) : null;
  }
  if (type === "planned") {
    const entry = findGrantPage(rawId);
    return entry?.kind === "planned" ? fetchPlannedGrant(entry.grant) : null;
  }
  if (type === "direct") {
    const call = getCurrentDirectEuCalls().find((item) => item.id === rawId);
    return call ? fetchDirectEu(call) : null;
  }
  if (type === "eu-topic") {
    const topic = getCurrentEuFundingTopics().find((item) => item.id === rawId.toLocaleLowerCase("en-US"));
    return topic ? fetchEuFundingTopic(topic) : null;
  }
  if (type === "topic") return fetchTopicEntity(rawId);
  if (type === "article") return fetchArticleEntity(rawId);
  return null;
}

export async function renderEuMoneyEntities(ids: string[]) {
  const bounded = [...new Set(ids.map((id) => cleanText(id, 500)).filter(Boolean))].slice(0, 10);
  const fetched = await Promise.all(bounded.map((id) => fetchEuMoney(id)));
  return fetched.flatMap((item) => item ? [item.card] : []);
}
