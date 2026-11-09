"use strict";

const select = (id) => document.getElementById(id);
const preview = select("preview");
const artboard = select("artboard");
const stage = select("stage");
const glyphButtons = select("glyphs");
const compare = select("compare");
const exportButton = select("export");
const glyphCache = new Map();
const imported = new Map();
let original;
let filename = "";
let family = "greek";
let active = glyphEntries.greek[0];
let activeSource = null;
const rememberedSources = new Map();
let glyph = null;
let originalView = false;
let size = 49;
let settings = { ...effectsByName.off };
let activePreset = "off";
let effectScope = "background";
let requestedImage = 0;
let requestedGlyph = 0;
let pendingFrame = 0;
let toastTimer = 0;

function notifyUser(message) {
  const toast = select("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function decodeImage(url, cors = false) {
  const image = new Image();
  if (cors) {
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
  }
  image.src = url;
  return image.decode().then(() => image);
}

async function readLocalImage(file) {
  const url = URL.createObjectURL(file);
  try {
    return await decodeImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function findGlyphBounds(image) {
  const factor = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * factor));
  const height = Math.max(1, Math.round(image.naturalHeight * factor));
  const context = layer(width, height, { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 24) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) throw new Error("Empty glyph");
  left = Math.floor(Math.max(0, left - 2) * image.naturalWidth / width);
  top = Math.floor(Math.max(0, top - 2) * image.naturalHeight / height);
  right = Math.ceil(Math.min(width, right + 3) * image.naturalWidth / width);
  bottom = Math.ceil(Math.min(height, bottom + 3) * image.naturalHeight / height);
  return { image, x: left, y: top, width: right - left, height: bottom - top };
}

function sourcesFor(entry) {
  if (!entry) return [];
  const local = Array.from(imported.values(), (item) => item.source)
    .filter((source) => source.key.startsWith(entry.id + "/"));
  const recipes = coverRecipes.filter((recipe) =>
    recipe.mapset && recipe.key.startsWith(entry.id + "/") && !imported.has(recipe.key));
  if (entry.sources?.length && family === "greek") return [...entry.sources, ...local, ...recipes];
  return [...local, ...recipes, ...(entry.sources ?? [])];
}

async function loadGlyphImage(source) {
  if (source.mapset) return loadRemoteCover(source);
  const image = await decodeImage(source.url, true);
  if (!source.crop) return image;
  return readLocalImage(await encodeGlyph(clipGlyph(image, source)));
}

function getGlyph(source) {
  if (imported.has(source.key)) return Promise.resolve(imported.get(source.key).glyph);
  if (!glyphCache.has(source.key)) {
    const pending = loadGlyphImage(source).then(findGlyphBounds);
    glyphCache.set(source.key, pending);
    pending.catch(() => glyphCache.delete(source.key));
  }
  return glyphCache.get(source.key);
}

function showVariants() {
  const variants = select("variants");
  variants.replaceChildren();
  for (const [index, source] of sourcesFor(active).entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `选项${index + 1}`;
    button.setAttribute("aria-pressed", String(source.key === activeSource?.key));
    button.addEventListener("click", () => selectGlyph(active, source.key));
    variants.append(button);
  }
}

async function selectGlyph(entry, key = rememberedSources.get(entry?.id)) {
  active = entry;
  const sources = sourcesFor(entry);
  activeSource = sources.find((source) => source.key === key) ?? sources[0] ?? null;
  if (activeSource) rememberedSources.set(entry.id, activeSource.key);
  const request = ++requestedGlyph;
  glyph = null;
  updateGlyphButtons();
  showVariants();
  requestRender();
  if (!activeSource) return;
  try {
    const result = await getGlyph(activeSource);
    if (request !== requestedGlyph) return;
    glyph = result;
    requestRender();
  } catch {
    if (request === requestedGlyph) notifyUser("字形加载失败");
  }
}

function updateGlyphButtons() {
  for (const button of glyphButtons.children) {
    button.setAttribute("aria-pressed", String(button.dataset.id === (active?.id ?? "")));
  }
  for (const button of document.querySelectorAll("[data-family]")) {
    button.setAttribute("aria-pressed", String(button.dataset.family === family));
  }
}

function showFamily() {
  glyphButtons.replaceChildren();
  const entries = [...glyphEntries[family], { id: "", label: "无" }];
  if (imported.has("custom/local")) entries.push({ id: "custom", label: "自选" });
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = entry.id;
    button.textContent = entry.label;
    if (entry.id && entry.id !== "custom" && sourcesFor(entry).some((source) => imported.has(source.key))) {
      button.classList.add("is-imported");
      button.title = "原包字形";
    }
    button.addEventListener("click", () => selectGlyph(entry.id ? entry : null));
    glyphButtons.append(button);
  }
  updateGlyphButtons();
}

const controls = new Map();
function addSlider(host, key, label, value, minimum, maximum, change) {
  const input = document.createElement("input");
  input.type = "range";
  input.id = "range-" + key;
  input.min = minimum;
  input.max = maximum;
  const text = document.createElement("label");
  text.htmlFor = input.id;
  text.textContent = label;
  const output = document.createElement("output");
  output.htmlFor = input.id;
  host.append(text, input, output);
  function update(next) {
    input.value = next;
    output.value = next + "%";
    input.style.setProperty("--fill", (next - minimum) / (maximum - minimum) * 100 + "%");
  }
  controls.set(key, update);
  input.addEventListener("input", () => {
    const next = Number(input.value);
    update(next);
    change(next);
    requestRender();
  });
  update(value);
}

function markPreset() {
  for (const button of select("presets").children) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === activePreset));
  }
}

function setPreset(name) {
  settings = { ...effectsByName[name] };
  activePreset = name;
  for (const [key, update] of controls) {
    if (key in settings) update(settings[key]);
  }
  markPreset();
  requestRender();
}

function requestRender() {
  if (!original || pendingFrame) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    const css = getComputedStyle(stage);
    const availableWidth = stage.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const availableHeight = stage.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
    const sourceWidth = original.naturalWidth;
    const sourceHeight = original.naturalHeight;
    const scale = Math.max(.001, Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const pixelRatio = Math.min(devicePixelRatio || 1, 2, 1500 / Math.max(width, height));
    preview.width = Math.max(1, Math.round(width * pixelRatio));
    preview.height = Math.max(1, Math.round(height * pixelRatio));
    artboard.style.width = width + "px";
    artboard.style.height = height + "px";
    select("resolution").value = sourceWidth + " × " + sourceHeight;
    select("zoom").value = Math.round(scale * 100) + "%";
    renderArtwork(preview, original, glyph, size, settings, effectScope, originalView);
  });
}

async function loadArtwork(source) {
  const request = ++requestedImage;
  try {
    const image = source ? await readLocalImage(source) : await decodeImage("./assets/demo.svg");
    if (request !== requestedImage) return;
    original = image;
    filename = source?.name ?? "";
    select("file-name").textContent = filename || "示例图";
    select("file-name").title = filename;
    originalView = false;
    compare.setAttribute("aria-pressed", "false");
    exportButton.disabled = false;
    requestRender();
  } catch {
    if (request !== requestedImage) return;
    notifyUser("无法打开图片");
    if (!original && source) loadArtwork();
  }
}

async function exportArtwork() {
  if (!original) return;
  exportButton.disabled = true;
  const image = original;
  const source = activeSource;
  const exportName = (filename.replace(/\.[^.]+$/, "") || "图片") + (active ? "-" + active.label : "") + ".png";
  const exportSettings = { ...settings };
  const exportSize = size;
  const scope = effectScope;
  try {
    const mark = source ? await getGlyph(source) : null;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    renderArtwork(canvas, image, mark, exportSize, exportSettings, scope);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Canvas export failed");
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = exportName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch {
    notifyUser("导出失败");
  } finally {
    exportButton.disabled = false;
  }
}

function bindFile(button, input, handle) {
  select(button).addEventListener("click", () => select(input).click());
  select(input).addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) handle(file);
    event.target.value = "";
  });
}

async function applyImported(records, selectNew = false) {
  const ready = await Promise.all(records.map(async (record) => {
    const glyph = findGlyphBounds(await readLocalImage(record.blob));
    return { source: { key: record.key, label: record.label }, glyph };
  }));
  for (const item of ready) {
    if (selectNew || !imported.has(item.source.key)) imported.set(item.source.key, item);
  }
  if (selectNew) {
    const item = ready.find(({ source }) => source.key.startsWith(active?.id + "/")) ?? ready[0];
    const id = item.source.key.split("/")[0];
    const nextFamily = Object.keys(glyphEntries).find((group) => glyphEntries[group].some((entry) => entry.id === id));
    if (nextFamily) family = nextFamily;
    showFamily();
    const entry = nextFamily ? glyphEntries[family].find((entry) => entry.id === id) : { id, label: "自选" };
    selectGlyph(entry, item.source.key);
  } else {
    showFamily();
    showVariants();
  }
}

async function importGlyph(file) {
  try {
    const archive = /\.(osz|zip)$/i.test(file.name);
    const records = archive ? await importGlyphArchive(file) : [{ key: "custom/local", label: "本地字形", blob: file }];
    await applyImported(records, true);
    saveGlyphRecords(records).catch(() => {});
    if (archive) notifyUser(`已导入 ${records.length} 个字样`);
  } catch {
    notifyUser("无法导入字形");
  }
}

addSlider(select("size-control"), "size", "大小", size, 8, 90, (value) => { size = value; });
for (const [key, label] of [
  ["rgb", "色散"], ["bloom", "辉光"], ["grain", "颗粒"], ["vignette", "暗角"],
  ["blur", "柔焦"], ["glitch", "错行"], ["contrast", "对比"],
]) {
  const host = document.createElement("div");
  host.className = "slider";
  select("effects").append(host);
  addSlider(host, key, label, settings[key], 0, 100, (value) => {
    settings[key] = value;
    activePreset = null;
    markPreset();
  });
}
for (const [name, preset] of Object.entries(effectsByName)) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.preset = name;
  const sample = document.createElement("span");
  sample.className = "preset-preview preset-" + name;
  sample.setAttribute("aria-hidden", "true");
  button.append(sample, preset.label);
  button.addEventListener("click", () => setPreset(name));
  select("presets").append(button);
}

for (const button of document.querySelectorAll("[data-family]")) {
  button.addEventListener("click", () => {
    family = button.dataset.family;
    showFamily();
    if (active && !glyphEntries[family].some((entry) => entry.id === active.id)) {
      selectGlyph(glyphEntries[family][0]);
    }
  });
}

const scopeButtons = document.querySelectorAll("[data-scope]");
for (const button of scopeButtons) {
  button.addEventListener("click", () => {
    effectScope = button.dataset.scope;
    for (const option of scopeButtons) {
      option.setAttribute("aria-pressed", String(option.dataset.scope === effectScope));
    }
    requestRender();
  });
}

bindFile("open-image", "image-file", loadArtwork);
bindFile("custom-glyph", "glyph-file", importGlyph);
exportButton.addEventListener("click", exportArtwork);
select("reset-effects").addEventListener("click", () => setPreset("off"));
compare.addEventListener("click", () => {
  originalView = !originalView;
  compare.setAttribute("aria-pressed", String(originalView));
  requestRender();
});
window.addEventListener("paste", (event) => {
  const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
  if (file) loadArtwork(file);
});
for (const event of ["dragenter", "dragover"]) {
  stage.addEventListener(event, (action) => {
    if (!action.dataTransfer.types.includes("Files")) return;
    action.preventDefault();
    action.dataTransfer.dropEffect = "copy";
    select("drop").hidden = false;
  });
}
stage.addEventListener("dragleave", (event) => {
  if (!stage.contains(event.relatedTarget)) select("drop").hidden = true;
});
stage.addEventListener("drop", (event) => {
  event.preventDefault();
  select("drop").hidden = true;
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (/\.(osz|zip)$/i.test(file.name)) importGlyph(file);
  else loadArtwork(file);
});
new ResizeObserver(requestRender).observe(stage);
showFamily();
markPreset();
exportButton.disabled = true;
loadArtwork();
selectGlyph(active, "alpha/icyilc");

readGlyphRecords().then((records) => applyImported(records)).catch(() => {});
