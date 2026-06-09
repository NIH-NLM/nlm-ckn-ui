const pptxgen = require("/Users/martinleach/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pptxgenjs");
const path = require("node:path");

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "NLM CKN";
pptx.company = "National Library of Medicine";
pptx.subject = "Ask a Question architecture for the NLM Cell Knowledge Network";
pptx.title = "Ask a Question: Conversational Graph Exploration for NLM CKN";
pptx.lang = "en-US";
pptx.theme = {
  headFontFace: "Aptos Display",
  bodyFontFace: "Aptos",
  lang: "en-US",
};
pptx.defineLayout({ name: "CUSTOM_WIDE", width: 13.333, height: 7.5 });
pptx.layout = "CUSTOM_WIDE";
pptx.margin = 0;

const C = {
  ink: "16212F",
  muted: "5C6778",
  blue: "225B93",
  cyan: "22A6B3",
  green: "3D8B57",
  red: "C44536",
  amber: "D58936",
  purple: "7B4AB2",
  magenta: "A23E8C",
  paper: "F7F4EE",
  white: "FFFFFF",
  line: "CCD3DA",
  paleBlue: "EAF2FA",
  paleGreen: "EAF6EF",
  paleAmber: "FBF1DF",
  darkPanel: "223043",
};

function addBg(slide, fill = C.paper) {
  slide.background = { color: fill };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: fill }, line: { color: fill } });
}

function footer(slide, n) {
  slide.addText("NLM Cell Knowledge Network  |  Ask a Question capability", {
    x: 0.55, y: 7.12, w: 7.5, h: 0.18, fontFace: "Aptos", fontSize: 6.8, color: "7C8795", margin: 0,
  });
  slide.addText(String(n).padStart(2, "0"), {
    x: 12.2, y: 7.08, w: 0.55, h: 0.22, fontFace: "Aptos", fontSize: 8, color: "7C8795", bold: true, align: "right", margin: 0,
  });
}

function kicker(slide, label, color = C.cyan) {
  slide.addShape(pptx.ShapeType.rect, { x: 0.58, y: 0.44, w: 0.18, h: 0.18, fill: { color }, line: { color } });
  slide.addText(label.toUpperCase(), {
    x: 0.86, y: 0.395, w: 3.5, h: 0.28, fontFace: "Aptos", fontSize: 8.5, bold: true, color: C.muted, charSpace: 1.6, margin: 0,
  });
}

function title(slide, text, sub) {
  slide.addText(text, {
    x: 0.55, y: 0.78, w: 9.8, h: 0.8, fontFace: "Aptos Display", fontSize: 27, bold: true, color: C.ink, breakLine: false, fit: "shrink", margin: 0,
  });
  if (sub) {
    slide.addText(sub, {
      x: 0.58, y: 1.55, w: 10.6, h: 0.45, fontFace: "Aptos", fontSize: 11.2, color: C.muted, fit: "shrink", margin: 0.02,
    });
  }
}

function pill(slide, text, x, y, w, color, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: opts.h || 0.38,
    rectRadius: 0.06,
    fill: { color: opts.fill || C.white, transparency: opts.transparency || 0 },
    line: { color: color || C.line, width: 1 },
  });
  slide.addText(text, {
    x: x + 0.12, y: y + 0.085, w: w - 0.24, h: 0.16,
    fontFace: "Aptos", fontSize: opts.fontSize || 8.5, bold: opts.bold ?? true, color: opts.textColor || color || C.ink, margin: 0, fit: "shrink",
  });
}

function box(slide, x, y, w, h, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    rectRadius: 0.06,
    fill: { color: opts.fill || C.white, transparency: opts.transparency || 0 },
    line: { color: opts.line || C.line, width: opts.lineWidth || 1 },
  });
}

function text(slide, t, x, y, w, h, opts = {}) {
  slide.addText(t, {
    x, y, w, h,
    fontFace: opts.face || "Aptos",
    fontSize: opts.size || 11,
    bold: opts.bold || false,
    color: opts.color || C.ink,
    margin: opts.margin ?? 0.02,
    fit: opts.fit || "shrink",
    breakLine: false,
    valign: opts.valign || "top",
    align: opts.align || "left",
    bullet: opts.bullet,
  });
}

function arrow(slide, x1, y1, x2, y2, color = C.blue) {
  slide.addShape(pptx.ShapeType.line, {
    x: x1, y: y1, w: x2 - x1, h: y2 - y1,
    line: { color, width: 1.8, beginArrowType: "none", endArrowType: "triangle" },
  });
}

function node(slide, label, x, y, color, sub) {
  slide.addShape(pptx.ShapeType.ellipse, { x, y, w: 0.56, h: 0.56, fill: { color }, line: { color: C.white, width: 1.2 } });
  text(slide, label, x + 0.68, y + 0.03, 1.75, 0.25, { size: 9.2, bold: true });
  if (sub) text(slide, sub, x + 0.68, y + 0.29, 1.75, 0.25, { size: 7.2, color: C.muted });
}

function metric(slide, value, label, x, y, color) {
  text(slide, value, x, y, 1.5, 0.42, { size: 24, bold: true, color });
  text(slide, label, x, y + 0.47, 1.7, 0.45, { size: 8.5, color: C.muted });
}

// 1 cover
{
  const s = pptx.addSlide(); addBg(s, C.ink);
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: C.ink }, line: { color: C.ink } });
  s.addShape(pptx.ShapeType.arc, { x: 7.9, y: -1.3, w: 5.9, h: 5.9, adjustPoint: 0.35, line: { color: "3AA6B9", transparency: 45, width: 2 }, fill: { color: C.ink, transparency: 100 } });
  s.addShape(pptx.ShapeType.arc, { x: 8.45, y: 0.35, w: 4.2, h: 4.2, adjustPoint: 0.25, line: { color: "D58936", transparency: 35, width: 2 }, fill: { color: C.ink, transparency: 100 } });
  kicker(s, "Knowledge graph conference", C.cyan);
  text(s, "Ask a Question", 0.6, 1.38, 6.2, 0.65, { size: 36, bold: true, color: C.white, face: "Aptos Display" });
  text(s, "Conversational graph exploration for the NLM Cell Knowledge Network", 0.64, 2.18, 6.6, 0.58, { size: 17.5, color: "DCE7F2" });
  text(s, "Natural language questions become validated AQL, graph-shaped evidence, and iterative biomedical discovery workflows.", 0.67, 3.08, 6.0, 0.9, { size: 12.2, color: "B9C7D6" });
  metric(s, "18+", "schema concepts exposed as query targets", 0.72, 5.25, C.cyan);
  metric(s, "2", "graphs selectable in the UI", 3.0, 5.25, C.amber);
  metric(s, "10", "node-specific suggestion chips", 4.75, 5.25, C.green);
  footer(s, 1);
}

// 2 thesis
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Thesis", C.red); title(s, "The product shift is from query writing to graph steering.", "Ask a Question is not a chatbot bolted onto search. It is a graph construction and refinement workflow.");
  box(s, 0.75, 2.15, 3.1, 2.8, { fill: C.white });
  box(s, 5.1, 2.15, 3.1, 2.8, { fill: C.paleBlue, line: "B7CAE0" });
  box(s, 9.45, 2.15, 3.1, 2.8, { fill: C.paleGreen, line: "B8D7C4" });
  text(s, "Before", 0.98, 2.45, 2.1, 0.25, { size: 12, bold: true, color: C.red });
  text(s, "Users needed to know collections, edge names, traversal direction, AQL syntax, and result shaping.", 0.98, 3.0, 2.35, 1.4, { size: 13.2, color: C.ink });
  text(s, "Translation layer", 5.35, 2.45, 2.4, 0.25, { size: 12, bold: true, color: C.blue });
  text(s, "The system maps intent to CKN concepts, chooses deterministic or generated AQL, validates safety, and returns graph evidence.", 5.35, 3.0, 2.35, 1.4, { size: 13.2 });
  text(s, "After", 9.68, 2.45, 2.1, 0.25, { size: 12, bold: true, color: C.green });
  text(s, "Users ask, inspect, refine, prune, expand, save, and reload graph states as reusable knowledge objects.", 9.68, 3.0, 2.35, 1.4, { size: 13.2 });
  arrow(s, 3.95, 3.55, 4.95, 3.55); arrow(s, 8.3, 3.55, 9.3, 3.55);
  footer(s, 2);
}

// 3 architecture
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Architecture", C.blue); title(s, "A small set of services creates a full conversational graph loop.", "React owns the interaction state; Django owns planning, safety, execution, and graph normalization.");
  const stages = [
    ["React Ask UI", "chat, mode, table/graph, selection, save", C.blue],
    ["Ask API", "serializer validation and graph choice", C.cyan],
    ["Question service", "plans, OpenAI fallback, recovery", C.green],
    ["ArangoDB CKN", "named graph traversal over loaded collections", C.amber],
    ["Graph response", "rows, nodes, links, suggestions", C.purple],
  ];
  stages.forEach(([a,b,c], i) => {
    const x = 0.6 + i * 2.45;
    box(s, x, 2.3, 2.05, 1.75, { fill: C.white, line: c, lineWidth: 1.3 });
    text(s, a, x + 0.18, 2.58, 1.7, 0.32, { size: 12, bold: true, color: c });
    text(s, b, x + 0.18, 3.1, 1.7, 0.56, { size: 8.7, color: C.muted });
    if (i < stages.length - 1) arrow(s, x + 2.1, 3.18, x + 2.35, 3.18, C.muted);
  });
  text(s, "Key backend contracts", 0.76, 5.15, 2.5, 0.3, { size: 12, bold: true });
  ["POST /arango_api/ask/", "POST /arango_api/ask/node-suggestions/", "QuestionRequestSerializer: question, graph, mode, history", "Read-only AQL validation before execution"].forEach((t, i) => {
    pill(s, t, 3.0 + (i % 2) * 4.7, 5.02 + Math.floor(i / 2) * 0.55, 4.35, i % 2 ? C.green : C.blue);
  });
  footer(s, 3);
}

// 4 planner cascade
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Planner cascade", C.green); title(s, "The system prefers deterministic CKN knowledge before asking a model.", "Common biomedical paths are encoded directly; OpenAI fills gaps with live schema context and read-only constraints.");
  const rows = [
    ["1", "Refine plan", "If mode=refine, expand from latest graph summary."],
    ["2", "Deterministic traversal", "Disease-gene, disease-gene-cell, drug-trial, retina-cell-set, and other known paths."],
    ["3", "Explicit collection search", "Collection label contains / matching queries."],
    ["4", "OpenAI AQL", "Schema-grounded JSON response when deterministic coverage ends."],
    ["5", "Fallback + recovery", "Broad text search or deterministic recovery on failures / zero rows."],
  ];
  rows.forEach(([n,h,d], i) => {
    const y = 1.95 + i * 0.78;
    s.addShape(pptx.ShapeType.ellipse, { x: 0.78, y, w: 0.38, h: 0.38, fill: { color: [C.green,C.blue,C.amber,C.purple,C.red][i] }, line: { color: C.white } });
    text(s, n, 0.89, y + 0.08, 0.16, 0.12, { size: 8, bold: true, color: C.white, align: "center" });
    text(s, h, 1.38, y - 0.02, 2.3, 0.25, { size: 12.3, bold: true });
    text(s, d, 3.55, y - 0.02, 7.8, 0.25, { size: 10.5, color: C.muted });
  });
  box(s, 8.85, 1.78, 3.65, 4.2, { fill: C.darkPanel, line: C.darkPanel });
  text(s, "Safety invariant", 9.15, 2.12, 2.6, 0.28, { size: 13, bold: true, color: C.white });
  text(s, "Every generated query is normalized and validated as read-only before execution. Mutating AQL and system collection access are blocked.", 9.15, 2.68, 2.85, 1.15, { size: 11, color: "D7E1EC" });
  text(s, "Design choice", 9.15, 4.28, 2.6, 0.28, { size: 13, bold: true, color: C.cyan });
  text(s, "Model output is useful, but never trusted blindly. The CKN schema and validator remain the guardrails.", 9.15, 4.82, 2.85, 0.95, { size: 10.5, color: "D7E1EC" });
  footer(s, 4);
}

// 5 schema map
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Schema grounding", C.amber); title(s, "Natural language is anchored to CKN concepts and edge definitions.", "The system combines a LinkML-informed concept map with live Arango collection and graph metadata.");
  const cols = [
    ["Disease", "MONDO", C.red], ["Gene", "GS", C.blue], ["Cell type", "CL", C.green], ["Drug", "CHEMBL", C.purple],
    ["Protein", "PR", "8F5F2A"], ["Anatomy", "UBERON", C.amber], ["Cell set", "CS", "2A9D8F"], ["Dataset", "CSD", "0F766E"],
    ["Trial", "NCT", C.magenta], ["Publication", "PUB", "667085"], ["Phenotype", "HP", "44546A"], ["Process", "GO", "5B8A72"],
  ];
  cols.forEach(([name, code, color], i) => {
    const x = 0.7 + (i % 4) * 2.95;
    const y = 2.05 + Math.floor(i / 4) * 0.92;
    pill(s, `${name}  ${code}`, x, y, 2.25, color, { fill: C.white, h: 0.48, fontSize: 9.2 });
  });
  text(s, "Planning inputs", 0.75, 5.15, 2.1, 0.25, { size: 12, bold: true });
  text(s, "aliases + sampled fields + counts + named graph edge definitions + association hints", 2.55, 5.15, 8.8, 0.25, { size: 11, color: C.muted });
  text(s, "Example edge hints", 0.75, 5.85, 2.1, 0.25, { size: 12, bold: true });
  text(s, "GS-MONDO, CL-GS, CHEMBL-GS, CHEMBL-NCT, CS-UBERON, CSD-PUB", 2.55, 5.85, 8.8, 0.25, { size: 11, color: C.muted });
  footer(s, 5);
}

// 6 example retina
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Worked example", C.green); title(s, "“Show cell sets reachable from retina” becomes a direct anatomy traversal.", "The parser extracts retina as the focus term, maps cell sets to CS, and uses CS-UBERON as the evidence edge.");
  box(s, 0.68, 2.0, 3.25, 2.15, { fill: C.white });
  text(s, "Question", 0.93, 2.28, 1.3, 0.24, { size: 11, bold: true, color: C.green });
  text(s, "Show cell sets reachable from retina.", 0.93, 2.82, 2.4, 0.7, { size: 17, bold: true, color: C.ink });
  box(s, 4.65, 1.78, 3.95, 2.55, { fill: C.paleGreen, line: "B8D7C4" });
  text(s, "Interpretation", 4.92, 2.07, 2.0, 0.24, { size: 11, bold: true, color: C.green });
  ["target = CS", "source = UBERON", "term = retina", "edge = CS-UBERON"].forEach((t, i) => text(s, t, 5.0, 2.55 + i * 0.38, 2.4, 0.22, { size: 11.5 }));
  node(s, "retina", 3.45, 5.35, C.amber, "UBERON/0000966");
  node(s, "cell set", 6.25, 4.75, "2A9D8F", "CS");
  node(s, "cell set", 6.25, 5.85, "2A9D8F", "CS");
  arrow(s, 5.95, 5.03, 4.15, 5.48, "7C8795");
  arrow(s, 5.95, 6.10, 4.15, 5.63, "7C8795");
  text(s, "DERIVES_FROM", 4.9, 5.18, 1.2, 0.18, { size: 7.2, color: C.muted });
  text(s, "AQL returns anatomy, cell_set, edge, and path so the graph can show evidence, not just a list.", 8.95, 2.05, 3.1, 2.4, { size: 15, color: C.ink });
  footer(s, 6);
}

// 7 output evidence
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Evidence model", C.purple); title(s, "Every answer is shaped for both a table and a graph.", "Rows are useful for inspection; nodes and links are required for explanation and follow-up.");
  const left = [
    ["Rows", "documents and nested result objects for table inspection"],
    ["Nodes", "human-readable labels, collection colors, tooltip fields"],
    ["Links", "edge docs, source/target IDs, labels, paths"],
    ["AQL", "generated, recovered, expanded, or pruned query text"],
    ["Suggestions", "counted follow-up questions with nonzero data"],
  ];
  left.forEach(([h,d], i) => {
    const y = 1.85 + i * 0.78;
    text(s, h, 0.82, y, 1.25, 0.25, { size: 12.3, bold: true, color: [C.blue,C.green,C.purple,C.red,C.amber][i] });
    text(s, d, 2.05, y, 4.8, 0.25, { size: 10.8, color: C.muted });
  });
  box(s, 7.2, 1.72, 4.8, 3.85, { fill: C.white });
  text(s, "Result payload", 7.5, 2.0, 1.7, 0.25, { size: 12, bold: true });
  text(s, "{\n  answer,\n  aql,\n  bind_vars,\n  columns,\n  rows,\n  nodes,\n  links,\n  suggested_questions\n}", 7.55, 2.5, 3.3, 2.15, { face: "Aptos Mono", size: 13, color: C.ink });
  text(s, "The same result object powers conversation memory, graph rendering, pruning, and export.", 7.55, 5.03, 3.7, 0.35, { size: 9.4, color: C.muted });
  footer(s, 7);
}

// 8 refine loop
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Conversation memory", C.cyan); title(s, "Follow-up questions expand the graph instead of starting over.", "The frontend sends compact result summaries; the backend uses node IDs as anchors for refine plans.");
  const steps = [
    ["1", "Ask", "what genes are associated with Alzheimer disease?"],
    ["2", "Inspect", "graph contains disease, genes, and GS-MONDO edges"],
    ["3", "Refine", "can you show drugs associated with this?"],
    ["4", "Merge", "new drugs and edges are deduplicated into the current graph"],
  ];
  steps.forEach(([n,h,d], i) => {
    const x = 0.72 + i * 3.05;
    box(s, x, 2.15, 2.45, 2.2, { fill: i % 2 ? C.paleBlue : C.white, line: i % 2 ? "B7CAE0" : C.line });
    text(s, n, x + 0.17, 2.37, 0.3, 0.25, { size: 15, bold: true, color: [C.blue,C.green,C.purple,C.red][i] });
    text(s, h, x + 0.55, 2.42, 1.4, 0.25, { size: 12.2, bold: true });
    text(s, d, x + 0.22, 3.0, 1.95, 0.85, { size: 10.4, color: C.muted });
    if (i < steps.length - 1) arrow(s, x + 2.5, 3.2, x + 2.92, 3.2, C.muted);
  });
  text(s, "Default interaction", 0.8, 5.35, 2.1, 0.24, { size: 12, bold: true });
  text(s, "After graph results appear, pressing Enter defaults to Refine current graph. Users can explicitly choose New search.", 2.7, 5.35, 8.6, 0.28, { size: 11, color: C.muted });
  footer(s, 8);
}

// 9 suggestion system
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Suggestion engine", C.amber); title(s, "Suggestions are grounded by counts, not theoretical possibilities.", "The UI proposes follow-ups only when reachable graph data exists, and node-specific suggestions enrich within a time budget.");
  box(s, 0.72, 2.0, 5.2, 3.7, { fill: C.white });
  text(s, "Result-level suggestions", 1.0, 2.28, 3.0, 0.25, { size: 13, bold: true, color: C.blue });
  ["Look at collections already visible", "Count additional reachable target collections", "Only show chips with nonzero additions", "Run clicked chips as refine queries"].forEach((t, i) => text(s, t, 1.0, 2.88 + i * 0.45, 4.1, 0.24, { size: 11, color: C.ink }));
  box(s, 7.05, 2.0, 5.2, 3.7, { fill: C.paleAmber, line: "E8C77F" });
  text(s, "Node-level suggestions", 7.35, 2.28, 3.0, 0.25, { size: 13, bold: true, color: C.amber });
  ["Show local visible chips immediately", "Query direct neighbor collection counts", "Enrich additional collections one by one", "Cache by graph + node ID"].forEach((t, i) => text(s, t, 7.35, 2.88 + i * 0.45, 4.1, 0.24, { size: 11, color: C.ink }));
  text(s, "Example: retina node returns genes, diseases, cell types, proteins, datasets, cell sets, processes, species, biomarkers, and gene sets.", 1.0, 6.15, 10.8, 0.38, { size: 12, bold: true, color: C.ink });
  footer(s, 9);
}

// 10 graph curation
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Graph curation", C.red); title(s, "The graph viewer is an analysis surface, not just a picture.", "Users can manipulate the result set while preserving an AQL-backed view of what has been removed or expanded.");
  const tools = [
    ["Home", "fit all visible nodes"],
    ["Select", "draw a box without recentering"],
    ["Delete selected", "remove selected nodes and edges"],
    ["Delete singlets", "remove disconnected nodes"],
    ["Save", "persist and export loader-compatible JSON"],
    ["Expand", "resizable full-screen workspace"],
  ];
  tools.forEach(([h,d], i) => {
    const x = 0.78 + (i % 3) * 4.05;
    const y = 2.0 + Math.floor(i / 3) * 1.35;
    box(s, x, y, 3.25, 0.92, { fill: C.white });
    text(s, h, x + 0.18, y + 0.18, 1.25, 0.24, { size: 12.5, bold: true, color: [C.blue,C.green,C.red,C.amber,C.purple,C.cyan][i] });
    text(s, d, x + 1.35, y + 0.2, 1.55, 0.24, { size: 9.5, color: C.muted });
  });
  text(s, "Important distinction", 0.78, 5.35, 2.2, 0.25, { size: 12, bold: true });
  text(s, "Deletes are visualization/context deletes. They do not remove records from ArangoDB; they update the visible result and wrap the displayed AQL with exclusion filters.", 2.95, 5.35, 8.7, 0.4, { size: 10.8, color: C.muted });
  footer(s, 10);
}

// 11 export
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Persistence", C.purple); title(s, "Saved graphs support both in-app recall and file-based exchange.", "The Ask graph save action bridges the existing saved-graphs store and the existing loader-compatible export format.");
  box(s, 0.8, 2.05, 4.8, 3.6, { fill: C.white });
  text(s, "Internal saved graph", 1.1, 2.38, 2.5, 0.25, { size: 13, bold: true, color: C.purple });
  text(s, "name, timestamp, originNodeIds, settings, graphData, source question, answer, AQL", 1.1, 3.0, 3.55, 0.85, { size: 13, color: C.ink });
  text(s, "Purpose: load later through the existing saved graph workflow.", 1.1, 4.55, 3.6, 0.34, { size: 10, color: C.muted });
  box(s, 7.15, 2.05, 4.8, 3.6, { fill: C.paleBlue, line: "B7CAE0" });
  text(s, "Downloaded JSON", 7.45, 2.38, 2.5, 0.25, { size: 13, bold: true, color: C.blue });
  text(s, "{\n  \"nodes\": [...],\n  \"links\": [...]\n}", 7.5, 3.0, 2.8, 0.9, { face: "Aptos Mono", size: 16, color: C.ink });
  text(s, "Purpose: pass the existing Load from file validator without changing loader behavior.", 7.45, 4.55, 3.55, 0.45, { size: 10, color: C.muted });
  arrow(s, 5.75, 3.8, 6.95, 3.8, C.muted);
  footer(s, 11);
}

// 12 takeaways
{
  const s = pptx.addSlide(); addBg(s, C.ink);
  kicker(s, "Takeaways", C.cyan);
  text(s, "What makes this useful for CKN", 0.62, 0.95, 6.6, 0.52, { size: 30, bold: true, color: C.white, face: "Aptos Display" });
  const takes = [
    ["Schema-first", "The LinkML/Arango schema constrains and explains the query path."],
    ["Evidence-shaped", "Rows, nodes, edges, and paths are returned together."],
    ["Conversational", "Refine mode treats the current graph as memory."],
    ["Curatable", "Users prune, expand, save, and reload graphs."],
    ["Extensible", "New deterministic traversals can be added as CKN evolves."],
  ];
  takes.forEach(([h,d], i) => {
    const y = 1.85 + i * 0.82;
    s.addShape(pptx.ShapeType.rect, { x: 0.82, y: y + 0.08, w: 0.15, h: 0.15, fill: { color: [C.cyan,C.green,C.amber,C.purple,C.red][i] }, line: { color: [C.cyan,C.green,C.amber,C.purple,C.red][i] } });
    text(s, h, 1.12, y, 2.05, 0.25, { size: 14, bold: true, color: C.white });
    text(s, d, 3.05, y + 0.01, 7.1, 0.25, { size: 11.5, color: "C7D1DD" });
  });
  text(s, "Ask a Question turns a biomedical knowledge graph into an iterative reasoning surface.", 0.85, 6.42, 9.2, 0.36, { size: 16, bold: true, color: C.cyan });
  footer(s, 12);
}

const out = path.resolve(__dirname, "ask-a-question-ckn-conference.pptx");
pptx.writeFile({ fileName: out });
