"use strict";

const effectsByName = {
  off: { label: "原色", rgb: 0, bloom: 0, grain: 0, vignette: 0, blur: 0, glitch: 0, contrast: 0 },
  reform: { label: "色散", rgb: 52, bloom: 22, grain: 19, vignette: 28, blur: 5, glitch: 0, contrast: 23 },
  glitch: { label: "故障", rgb: 66, bloom: 15, grain: 29, vignette: 19, blur: 0, glitch: 66, contrast: 38 },
  soft: { label: "柔光", rgb: 12, bloom: 69, grain: 12, vignette: 30, blur: 20, glitch: 0, contrast: 9 },
};

const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function layer(width, height, options) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d", options);
}

function drawGlyph(context, glyph, width, height, size) {
  if (!glyph) return;
  const ratio = glyph.width / glyph.height;
  const glyphHeight = Math.min(Math.min(width, height) * size / 100, width * .85 / ratio);
  const glyphWidth = glyphHeight * ratio;
  context.drawImage(glyph.image, glyph.x, glyph.y, glyph.width, glyph.height, (width - glyphWidth) / 2, (height - glyphHeight) / 2, glyphWidth, glyphHeight);
}

function breakLines(context, width, height, strength) {
  if (!strength) return;
  const scratch = layer(width, height);
  scratch.drawImage(context.canvas, 0, 0);
  const random = randomGenerator(429);
  const strips = Math.ceil(strength / 7);
  const pixel = Math.max(1, height / 160);
  for (let strip = 0; strip < strips; strip++) {
    const y = Math.floor(random() * height);
    const band = Math.min(height - y, Math.ceil(pixel * (1 + random() * 6)));
    const offset = Math.round((random() - .5) * width * strength / 680);
    context.clearRect(0, y, width, band);
    context.drawImage(scratch.canvas, 0, y, width, band, offset, y, width, band);
    if (offset > 0) {
      context.drawImage(scratch.canvas, width - offset, y, offset, band, 0, y, offset, band);
    }
    if (offset < 0) {
      context.drawImage(scratch.canvas, 0, y, -offset, band, width + offset, y, -offset, band);
    }
  }
}

function applyPixelEffects(context, width, height, settings) {
  const { rgb, grain, contrast } = settings;
  if (!rgb && !grain && !contrast) return;
  const bitmap = context.getImageData(0, 0, width, height);
  const pixels = bitmap.data;
  const source = rgb ? new Uint8ClampedArray(pixels) : pixels;
  const shift = Math.round(Math.min(width, height) * rgb / 5300);
  const yShift = Math.round(shift / 2);
  const gain = 1 + contrast / 140;
  const noise = grain / 3.15;
  const random = randomGenerator(217);

  for (let y = 0; y < height; y++) {
    const redRow = clamp(y + yShift, 0, height - 1) * width;
    const blueRow = clamp(y - yShift, 0, height - 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const center = (row + x) * 4;
      const red = (redRow + Math.max(0, x - shift)) * 4;
      const blue = (blueRow + Math.min(width - 1, x + shift)) * 4;
      const bias = (grain ? (random() + random() - 1) * noise : 0) + 127 * (1 - gain);
      // A transparent neighbor contributes the center color, so alpha edges do not turn black.
      const redValue = pixels[center] + (source[red] - pixels[center]) * source[red + 3] / 255;
      const blueValue = pixels[center + 2] + (source[blue + 2] - pixels[center + 2]) * source[blue + 3] / 255;
      pixels[center] = redValue * gain + bias;
      pixels[center + 1] = pixels[center + 1] * gain + bias;
      pixels[center + 2] = blueValue * gain + bias;
    }
  }
  context.putImageData(bitmap, 0, 0);
}

function applyLight(context, width, height, settings) {
  const { bloom, blur, vignette } = settings;
  const unit = Math.min(width, height) / 1000;
  if (bloom || blur) {
    const scratch = layer(width, height);
    scratch.drawImage(context.canvas, 0, 0);
    context.save();
    context.globalCompositeOperation = "source-atop";
    if (blur) {
      context.filter = `blur(${blur * unit * .14}px)`;
      context.globalAlpha = .64;
      context.drawImage(scratch.canvas, 0, 0);
    }
    if (bloom) {
      const scale = Math.min(1, 720 / Math.max(width, height));
      const highlights = layer(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
      highlights.drawImage(scratch.canvas, 0, 0, highlights.canvas.width, highlights.canvas.height);
      const light = highlights.getImageData(0, 0, highlights.canvas.width, highlights.canvas.height);
      for (let i = 0; i < light.data.length; i += 4) {
        const peak = Math.max(light.data[i], light.data[i + 1], light.data[i + 2]);
        light.data[i + 3] *= Math.max(0, (peak - 120) / 135);
      }
      highlights.putImageData(light, 0, 0);
      context.filter = `blur(${(2 + bloom * .19) * unit}px) brightness(1.26)`;
      context.globalAlpha = bloom / 115;
      context.drawImage(highlights.canvas, 0, 0, width, height);
    }
    context.restore();
  }
  if (vignette) {
    context.save();
    context.globalCompositeOperation = "source-atop";
    context.scale(width, height);
    const gradient = context.createRadialGradient(.5, .5, .14, .5, .5, .71);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(.55, `rgba(0,0,0,${vignette / 780})`);
    gradient.addColorStop(1, `rgba(0,0,0,${vignette / 105})`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1, 1);
    context.restore();
  }
}

function renderArtwork(canvas, image, glyph, size, settings, scope, original = false) {
  const { width, height } = canvas;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  if (original) return;
  if (scope === "all") drawGlyph(context, glyph, width, height, size);
  breakLines(context, width, height, settings.glitch);
  applyPixelEffects(context, width, height, settings);
  applyLight(context, width, height, settings);
  if (scope === "background") drawGlyph(context, glyph, width, height, size);
}
