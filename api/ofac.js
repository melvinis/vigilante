// api/ofac.js
// Node.js serverless function — remove the edge runtime config entirely
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600");

  const URLS = [
    "https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml",
    "https://ofac.treasury.gov/system/files/126/cons_advanced.xml",
  ];

  for (const url of URLS) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Vigilante-AML/4.0)" },
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) continue;
      const xml = await r.text();
      const addresses = {};
      const matches = xml.matchAll(/<feature\s+feature-type="Digital Currency Address[^"]*"[^>]*>[\s\S]*?<feature-version[^>]*>[\s\S]*?<comment>([^<]+)<\/comment>[\s\S]*?<\/feature>/gi);
      let name = "SDN Entity";
      for (const m of matches) {
        const addr = m[1]?.trim();
        if (addr?.length > 15) {
          addresses[addr.toLowerCase()] = { label: `OFAC SDN: ${name}`, risk: 100, cat: "SANCTIONS", source: "OFAC_LIVE" };
          addresses[addr] = addresses[addr.toLowerCase()];
        }
      }
      return res.status(200).json({ addresses, count: Object.keys(addresses).length / 2 });
    } catch (e) { continue; }
  }

  res.status(502).json({ error: "All OFAC sources unavailable" });
}