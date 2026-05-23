const pptxgen = require("/Users/martinleach/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pptxgenjs");
const path = require("node:path");

const pptx = new pptxgen();
pptx.author = "NLM CKN";
pptx.company = "National Library of Medicine";
pptx.subject = "How Ask a Question converts prompts into deterministic traversals and AI-generated AQL";
pptx.title = "From Prompt to Traversal Plan";
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
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.333, h: 7.5,
    fill: { color: fill },
    line: { color: fill },
  });
}

function footer(slide, n) {
  slide.addText("NLM Cell Knowledge Network  |  Ask a Question planner", {
    x: 0.55, y: 7.12, w: 7.5, h: 0.18,
    fontFace: "Aptos", fontSize: 6.8, color: "7C8795", margin: 0,
  });
  slide.addText(String(n).padStart(2, "0"), {
    x: 12.2, y: 7.08, w: 0.55, h: 0.22,
    fontFace: "Aptos", fontSize: 8, color: "7C8795", bold: true, align: "right", margin: 0,
  });
}

function kicker(slide, label, color = C.cyan) {
  slide.addShape(pptx.ShapeType.rect, { x: 0.58, y: 0.44, w: 0.18, h: 0.18, fill: { color }, line: { color } });
  slide.addText(label.toUpperCase(), {
    x: 0.86, y: 0.395, w: 4.8, h: 0.28,
    fontFace: "Aptos", fontSize: 8.5, bold: true, color: C.muted, charSpace: 1.6, margin: 0,
  });
}

function title(slide, text, sub) {
  slide.addText(text, {
    x: 0.55, y: 0.78, w: 10.8, h: 0.8,
    fontFace: "Aptos Display", fontSize: 27, bold: true, color: C.ink, fit: "shrink", margin: 0,
  });
  if (sub) {
    slide.addText(sub, {
      x: 0.58, y: 1.55, w: 10.7, h: 0.45,
      fontFace: "Aptos", fontSize: 11.2, color: C.muted, fit: "shrink", margin: 0.02,
    });
  }
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
  });
}

function pill(slide, label, x, y, w, color, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: opts.h || 0.42,
    rectRadius: 0.06,
    fill: { color: opts.fill || C.white },
    line: { color, width: 1 },
  });
  text(slide, label, x + 0.12, y + 0.105, w - 0.24, 0.14, {
    size: opts.size || 8.7,
    bold: true,
    color: opts.textColor || color,
  });
}

function arrow(slide, x1, y1, x2, y2, color = C.blue) {
  slide.addShape(pptx.ShapeType.line, {
    x: x1, y: y1, w: x2 - x1, h: y2 - y1,
    line: { color, width: 1.8, beginArrowType: "none", endArrowType: "triangle" },
  });
}

function step(slide, n, label, detail, x, y, color) {
  slide.addShape(pptx.ShapeType.ellipse, { x, y, w: 0.42, h: 0.42, fill: { color }, line: { color: C.white, width: 1 } });
  text(slide, n, x + 0.13, y + 0.09, 0.16, 0.12, { size: 8, bold: true, color: C.white, align: "center" });
  text(slide, label, x + 0.62, y - 0.02, 2.3, 0.25, { size: 12.4, bold: true });
  text(slide, detail, x + 0.62, y + 0.34, 3.6, 0.45, { size: 9.4, color: C.muted });
}

// 1
{
  const s = pptx.addSlide(); addBg(s, C.ink);
  kicker(s, "Planner architecture", C.cyan);
  text(s, "From Prompt to Traversal Plan", 0.62, 1.35, 7.4, 0.65, { size: 35, bold: true, color: C.white, face: "Aptos Display" });
  text(s, "How Ask a Question decides between heuristics, deterministic CKN traversals, OpenAI-generated AQL, and fallback recovery.", 0.65, 2.24, 7.1, 0.72, { size: 15.5, color: "DCE7F2" });
  box(s, 8.05, 1.15, 4.25, 4.75, { fill: C.darkPanel, line: "314257" });
  ["Prompt", "Intent parser", "Deterministic paths", "OpenAI fallback", "Validated AQL", "Graph evidence"].forEach((label, i) => {
    pill(s, label, 8.55, 1.65 + i * 0.64, 3.18, [C.cyan, C.green, C.amber, C.purple, C.red, C.blue][i], { fill: "27374D" });
    if (i < 5) arrow(s, 10.14, 2.08 + i * 0.64, 10.14, 2.24 + i * 0.64, "8090A3");
  });
  text(s, "Core message", 0.72, 5.35, 1.7, 0.28, { size: 12, bold: true, color: C.cyan });
  text(s, "The LLM is a schema-grounded planner of last resort, not the primary execution engine.", 2.05, 5.35, 7.0, 0.3, { size: 14, bold: true, color: C.white });
  footer(s, 1);
}

// 2
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "End-to-end flow", C.blue);
  title(s, "The Ask pipeline turns language into graph-shaped evidence.", "The same result object powers the chat answer, table, graph, suggestions, refinement memory, and export.");
  const items = [
    ["1", "Prompt", "User asks a biomedical question in plain English.", C.blue],
    ["2", "Plan", "Choose follow-up, deterministic traversal, AI, or fallback.", C.green],
    ["3", "Validate", "Normalize AQL and block write/system operations.", C.red],
    ["4", "Execute", "Run against ontology + phenotype graphs in auto mode.", C.amber],
    ["5", "Shape", "Extract rows, nodes, links, paths, labels, suggestions.", C.purple],
  ];
  items.forEach(([n, h, d, c], i) => {
    const x = 0.68 + i * 2.5;
    box(s, x, 2.35, 2.02, 2.05, { fill: i % 2 ? C.paleBlue : C.white, line: i % 2 ? "B7CAE0" : C.line });
    text(s, n, x + 0.18, 2.58, 0.28, 0.25, { size: 17, bold: true, color: c });
    text(s, h, x + 0.55, 2.62, 1.1, 0.25, { size: 12, bold: true });
    text(s, d, x + 0.2, 3.18, 1.55, 0.72, { size: 9.4, color: C.muted });
    if (i < items.length - 1) arrow(s, x + 2.05, 3.36, x + 2.38, 3.36, C.muted);
  });
  text(s, "Returned payload", 0.82, 5.58, 1.9, 0.25, { size: 12, bold: true });
  text(s, "{ answer, aql, bind_vars, rows, nodes, links, graph, suggested_questions }", 2.45, 5.58, 8.6, 0.25, { face: "Aptos Mono", size: 11.2, color: C.muted });
  footer(s, 2);
}

// 3
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Planner cascade", C.green);
  title(s, "Deterministic plans get first refusal.", "The backend tries increasingly flexible planners before asking OpenAI to generate AQL.");
  const rows = [
    ["1", "Refine plan", "Current graph context is used when mode=refine.", C.cyan],
    ["2", "Traversal plan", "Hard-coded biomedical paths: disease-gene-cell, drug-trial, cell-dataset.", C.green],
    ["3", "Collection label search", "Explicit collection + label contains queries.", C.amber],
    ["4", "OpenAI AQL", "Schema-grounded JSON AQL only when heuristics do not match.", C.purple],
    ["5", "Fallback / recovery", "Broad search or deterministic retry when AQL fails or returns zero rows.", C.red],
  ];
  rows.forEach(([n, h, d, c], i) => step(s, n, h, d, 0.78, 1.93 + i * 0.86, c));
  box(s, 8.35, 1.85, 3.9, 3.9, { fill: C.darkPanel, line: C.darkPanel });
  text(s, "Why this order?", 8.68, 2.18, 2.4, 0.28, { size: 14, bold: true, color: C.white });
  text(s, "Known CKN paths are faster, easier to validate, and easier to explain than generated AQL. The model handles the long tail only after local planning fails.", 8.68, 2.83, 2.92, 1.15, { size: 11.2, color: "D7E1EC" });
  text(s, "Safety invariant", 8.68, 4.42, 2.4, 0.28, { size: 14, bold: true, color: C.cyan });
  text(s, "Every plan, including model output, is validated as read-only before execution.", 8.68, 4.95, 2.86, 0.48, { size: 10.8, color: "D7E1EC" });
  footer(s, 3);
}

// 4
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Deterministic traversals", C.amber);
  title(s, "Common biomedical intents map to explicit graph paths.", "These are local AQL templates with bind variables and graph-ready returned nodes and edges.");
  const paths = [
    ["genes for disease", "MONDO <- GS-MONDO <- GS", C.blue],
    ["cells for disease", "MONDO <- GS-MONDO <- GS <- CL-GS <- CL", C.green],
    ["drugs for disease", "MONDO <- GS-MONDO <- GS <- CHEMBL-GS <- CHEMBL", C.purple],
    ["trials for disease", "MONDO -> drug/gene routes -> CHEMBL-NCT -> NCT", C.magenta],
    ["datasets for cell", "CL -> CL-CSD -> CSD", C.amber],
    ["cell sets for anatomy", "UBERON <- CS-UBERON <- CS", C.red],
  ];
  paths.forEach(([h, d, c], i) => {
    const x = 0.78 + (i % 2) * 6.0;
    const y = 2.05 + Math.floor(i / 2) * 1.12;
    box(s, x, y, 5.25, 0.78, { fill: C.white, line: c, lineWidth: 1.2 });
    text(s, h, x + 0.2, y + 0.15, 1.55, 0.22, { size: 11.2, bold: true, color: c });
    text(s, d, x + 1.84, y + 0.15, 3.0, 0.22, { face: "Aptos Mono", size: 8.8, color: C.ink });
  });
  text(s, "Example prompt", 0.82, 5.9, 1.6, 0.25, { size: 12, bold: true });
  text(s, "“what are the genes associated with alzheimers?” -> MONDO term match -> GS-MONDO inbound genes -> rows + nodes + edges", 2.2, 5.9, 9.7, 0.28, { size: 10.7, color: C.muted });
  footer(s, 4);
}

// 5
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "Term expansion", C.cyan);
  title(s, "Entity matching uses normalized terms and UMLS candidates.", "The prompt term becomes bind variables, not string-concatenated AQL.");
  box(s, 0.78, 2.05, 3.2, 3.2, { fill: C.white });
  text(s, "Prompt", 1.05, 2.35, 1.0, 0.25, { size: 12, bold: true, color: C.blue });
  text(s, "what are the genes associated with alzheimers?", 1.05, 2.95, 2.25, 0.95, { size: 18, bold: true });
  arrow(s, 4.15, 3.6, 4.9, 3.6, C.muted);
  box(s, 5.05, 1.78, 3.35, 3.75, { fill: C.paleBlue, line: "B7CAE0" });
  text(s, "@terms", 5.35, 2.05, 1.2, 0.25, { size: 13, bold: true, color: C.blue });
  ["alzheimers", "alzheimer", "Alzheimer's Disease", "Alzheimer Disease, Early Onset", "Alzheimer Disease, Late Onset"].forEach((t, i) => {
    text(s, t, 5.35, 2.55 + i * 0.42, 2.6, 0.2, { size: 9.6, color: C.ink });
  });
  arrow(s, 8.55, 3.6, 9.28, 3.6, C.muted);
  box(s, 9.45, 2.05, 2.85, 3.2, { fill: C.white });
  text(s, "AQL filter", 9.75, 2.35, 1.5, 0.25, { size: 12, bold: true, color: C.green });
  text(s, "MATCH disease._id, label, definition, exact_synonym, hasExactSynonym, hasRelatedSynonym", 9.75, 2.95, 1.95, 1.25, { size: 11.2, color: C.muted });
  text(s, "UMLS improves recall; later graph paths provide precision.", 0.82, 5.95, 8.9, 0.3, { size: 13, bold: true, color: C.ink });
  footer(s, 5);
}

// 6
{
  const s = pptx.addSlide(); addBg(s);
  kicker(s, "AI boundary", C.purple);
  title(s, "OpenAI is used after heuristics, with live schema context.", "The model is asked for a read-only AQL JSON object, not an answer hallucination.");
  box(s, 0.82, 1.95, 4.0, 3.85, { fill: C.white });
  text(s, "What the model receives", 1.1, 2.25, 2.6, 0.25, { size: 13, bold: true, color: C.purple });
  ["question", "mode: new/refine", "recent result summaries", "live collections + fields", "named graph edge definitions", "rules for safe AQL"].forEach((t, i) => {
    pill(s, t, 1.12, 2.78 + i * 0.43, 2.85, [C.blue, C.green, C.amber, C.cyan, C.red, C.purple][i], { size: 8.1 });
  });
  box(s, 6.0, 1.95, 5.95, 3.85, { fill: C.darkPanel, line: C.darkPanel });
  text(s, "Required model output", 6.35, 2.25, 2.6, 0.25, { size: 13, bold: true, color: C.white });
  text(s, "{\n  \"aql\": \"...\",\n  \"bind_vars\": { ... },\n  \"answer\": \"...\"\n}", 6.38, 2.9, 3.1, 1.45, { face: "Aptos Mono", size: 16, color: "D7E1EC" });
  text(s, "temperature = 0\nread-only AQL only\nvalidated before execution", 9.62, 2.95, 1.75, 0.95, { size: 10.6, color: C.cyan });
  text(s, "If OpenAI fails or produces bad AQL, deterministic recovery is attempted before surfacing an error.", 0.88, 6.15, 10.7, 0.35, { size: 12.4, bold: true });
  footer(s, 6);
}

// 7
{
  const s = pptx.addSlide(); addBg(s, C.ink);
  kicker(s, "Operational takeaway", C.cyan);
  text(s, "A graph reasoning surface, not a generic chatbot", 0.62, 0.95, 8.4, 0.52, { size: 30, bold: true, color: C.white, face: "Aptos Display" });
  const takes = [
    ["Deterministic first", "Known CKN paths are encoded as explainable AQL templates."],
    ["AI for the long tail", "OpenAI proposes AQL only when local planners do not match."],
    ["Schema-grounded", "Live Arango collections, fields, and edge definitions constrain planning."],
    ["Safety checked", "All AQL is validated read-only before execution."],
    ["Evidence returned", "Answers carry rows, nodes, links, paths, and suggestions."],
  ];
  takes.forEach(([h, d], i) => {
    const y = 1.78 + i * 0.83;
    s.addShape(pptx.ShapeType.rect, { x: 0.82, y: y + 0.09, w: 0.15, h: 0.15, fill: { color: [C.cyan, C.purple, C.amber, C.red, C.green][i] }, line: { color: [C.cyan, C.purple, C.amber, C.red, C.green][i] } });
    text(s, h, 1.12, y, 2.3, 0.25, { size: 14, bold: true, color: C.white });
    text(s, d, 3.28, y + 0.01, 7.2, 0.25, { size: 11.5, color: "C7D1DD" });
  });
  text(s, "Design principle: let the model help plan, but let the graph schema, validators, and result evidence keep the system honest.", 0.85, 6.4, 10.2, 0.36, { size: 15, bold: true, color: C.cyan });
  footer(s, 7);
}

const out = path.resolve(__dirname, "ask-a-question-prompt-to-plan.pptx");
pptx.writeFile({ fileName: out }).then(() => console.log(out));
