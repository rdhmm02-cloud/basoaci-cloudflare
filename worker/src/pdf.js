import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function generateLaporanPdf(orders, periodLabel) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;
  const rowHeight = 20;
  const colX = [margin, margin + 60, margin + 260, margin + 350, margin + 430];
  const headers = ["ID", "Nama", "Total", "Status", "Tanggal"];

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function drawHeader() {
    page.drawText(`Laporan Pesanan - ${periodLabel}`, {
      x: margin, y, size: 14, font: fontBold, color: rgb(0, 0, 0),
    });
    y -= 25;
    headers.forEach((h, i) => {
      page.drawText(h, { x: colX[i], y, size: 9, font: fontBold });
    });
    y -= 12;
    page.drawLine({
      start: { x: margin, y }, end: { x: pageWidth - margin, y },
      thickness: 0.5, color: rgb(0.7, 0.7, 0.7),
    });
    y -= 12;
  }

  drawHeader();

  for (const o of orders) {
    if (y < margin + rowHeight) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      drawHeader();
    }

    const tanggal = o.created_at ? o.created_at.slice(0, 10) : "-";
    const row = [
      String(o.id),
      (o.buyer_name || "-").slice(0, 28),
      `Rp${Number(o.total || 0).toLocaleString("id-ID")}`,
      o.status || "-",
      tanggal,
    ];

    row.forEach((text, i) => {
      page.drawText(text, { x: colX[i], y, size: 8, font });
    });

    y -= rowHeight;
  }

  if (y < margin + 80) {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  }
  y -= 10;
  page.drawLine({
    start: { x: margin, y }, end: { x: pageWidth - margin, y },
    thickness: 0.5, color: rgb(0.7, 0.7, 0.7),
  });
  y -= 20;

  const total = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const selesai = orders.filter((o) => o.status === "Selesai").length;
  const dibatalkan = orders.filter((o) => o.status === "Dibatalkan").length;

  page.drawText(`Total Pesanan: ${orders.length}`, { x: margin, y, size: 10, font: fontBold });
  y -= 15;
  page.drawText(`Selesai: ${selesai}  |  Dibatalkan: ${dibatalkan}`, { x: margin, y, size: 10, font });
  y -= 15;
  page.drawText(`Total Omzet (semua status): Rp${total.toLocaleString("id-ID")}`, {
    x: margin, y, size: 10, font: fontBold,
  });

  return await pdfDoc.save();
}
