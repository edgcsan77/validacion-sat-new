import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  const norm = (s) => (s || "").toString().trim().toUpperCase();
  const pick = (obj, p) =>
    p.split(".").reduce((a, k) => (a && a[k] != null ? a[k] : undefined), obj);

  const body = req.body || {};
  const data = body.data || {};

  let D1 = (req.query && req.query.D1) || body.D1 || "";
  let D2 = (req.query && req.query.D2) || body.D2 || "";
  let D3 = (req.query && req.query.D3) || body.D3 || "";

  // compat: si no viene D3, intenta armarlo desde body.data
  if (!D3) {
    const idcif = pick(body, "data.IDCIF_ETIQUETA") || pick(body, "data.IDCIF") || "";
    const rfc = pick(body, "data.RFC") || "";
    if (idcif && rfc) {
      D1 = D1 || "10";
      D2 = D2 || "1";
      D3 = `${idcif}_${rfc}`;
    }
  }

  const got = {
    method: req.method,
    query: req.query || {},
    bodyKeys: Object.keys(body || {}),
    dataKeys: Object.keys(data || {}),
    extracted: { D1, D2, D3 },
  };

  // ✅ Aceptar D1=10 o D1=26, y D2=1
  const d1s = String(D1 || "").trim();
  const d2s = String(D2 || "").trim();
  if (!D3 || d2s !== "1" || (d1s !== "10" && d1s !== "26")) {
    return res.status(400).json({ ok: false, error: "QR inválido", got });
  }

  // =========================
  // 1) Intentar archivo individual: public/data/personas/<D3>.json
  // =========================
  const d3Raw = String(D3 || "").trim();
  const d3Enc = encodeURIComponent(d3Raw); // en el FS debes guardar igual que el nombre (sin encode) normalmente
  // OJO: en filesystem, el archivo usualmente se guarda literal con "_" y letras, no con %XX.
  // Así que intentamos primero literal, luego encode por si acaso.

  const baseDir = path.join(process.cwd(), "public", "data", "personas");
  const directPath1 = path.join(baseDir, `${d3Raw}.json`);
  const directPath2 = path.join(baseDir, `${d3Enc}.json`);

  const tryReadJson = (p) => {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw);
  };

  try {
    if (fs.existsSync(directPath1)) {
      const persona = tryReadJson(directPath1);
      return res.status(200).json({ ok: true, key: d3Raw, persona, source: "file", filePath: directPath1 });
    }
    if (fs.existsSync(directPath2)) {
      const persona = tryReadJson(directPath2);
      return res.status(200).json({ ok: true, key: d3Raw, persona, source: "file", filePath: directPath2 });
    }
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "No pude leer el JSON individual en public/data/personas/",
      directPath1,
      directPath2,
      reason: String(e?.message || e),
      got,
    });
  }

  // =========================
  // 1.5) Fallback remoto: GitHub RAW (porque el deploy NO se actualiza)
  // =========================
  try {
    const rawUrl =
      `https://raw.githubusercontent.com/edgcsan77/validacion-sat/main/public/data/personas/${encodeURIComponent(d3Raw)}.json`;

    const r = await fetch(`${rawUrl}?ts=${Date.now()}`, { cache: "no-store" });

    if (r.ok) {
      const persona = await r.json();
      return res.status(200).json({
        ok: true,
        key: d3Raw,
        persona,
        source: "github_raw",
        rawUrl,
      });
    }
  } catch (e) {
    // si GitHub falla, seguimos al fallback legacy (personas.json)
    // (no regresamos error aquí)
  }

  // =========================
  // 2) Fallback: personas.json grande
  // =========================
  let db;
  let filePath;
  try {
    filePath = path.join(process.cwd(), "public", "data", "personas.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    db = JSON.parse(raw);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "No pude leer public/data/personas.json en el server",
      filePath,
      reason: String(e?.message || e),
      got,
    });
  }

  const D3N = norm(d3Raw);
  const keys = Object.keys(db || {});
  const key = keys.find((k) => norm(k) === D3N);

  if (!key) {
    return res.status(404).json({
      ok: false,
      error: "No encontrado",
      d3: d3Raw,
      d3Norm: D3N,
      totalKeys: keys.length,
      filePath,
      hasExactKey: !!db[d3Raw],
      got,
    });
  }

  return res.status(200).json({ ok: true, key, persona: db[key], source: "db", filePath });
}
