exports.handler = async () => {
  try {
    const r = await fetch("https://dolarapi.com/v1/dolares/oficial", { cache: "no-store" });

    if (!r.ok) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No se pudo obtener cotización" }),
      };
    }

    const data = await r.json();
    const venta = Number(data.venta);

    if (!Number.isFinite(venta) || venta <= 0) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Cotización inválida" }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ rate: venta, fetchedAt: Date.now(), source: "dolarapi/oficial" }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Error de red" }),
    };
  }
};
