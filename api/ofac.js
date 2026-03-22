export const config = { runtime: "edge" };

export default async function handler() {
  try {
    const res = await fetch(
      "https://www.treasury.gov/ofac/downloads/sdnlist.txt",
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(60000),
      }
    );

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `HTTP ${res.status}` }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const text = await res.text();

    // Parse crypto addresses out of the SDN text file
    const addresses = {};
    const lines = text.split("\n");
    let currentName = "SDN Entity";

    for (const line of lines) {
      const t = line.trim();
      if (/^\d+\./.test(t)) {
        currentName = t.replace(/^\d+\.\s*/, "").split(";")[0].trim().slice(0, 60);
      }
      if (/Digital Currency Address|XBT Address|ETH Address/i.test(t)) {
        const m = t.match(/(?:Address\s*-\s*[A-Z]+:\s*)([A-Za-z0-9]{20,})/i);
        if (m && m[1]) {
          const addr = m[1].trim().replace(/[;.,]$/, "");
          addresses[addr.toLowerCase()] = {
            label: `OFAC SDN: ${currentName}`,
            risk: 100,
            cat: "SANCTIONS",
            source: "OFAC_LIVE",
          };
          addresses[addr] = addresses[addr.toLowerCase()];
        }
      }
    }

    return new Response(JSON.stringify({ addresses, count: Object.keys(addresses).length / 2 }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600", // cache for 1 hour at the edge
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}