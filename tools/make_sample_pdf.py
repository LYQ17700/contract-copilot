# -*- coding: utf-8 -*-
"""生成演示用 PDF 合同（Pod1 文档解析链路的输入样例）。"""
import sys
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "samples" / "租房合同-含坑.txt"
OUT = ROOT / "data" / "samples" / "租房合同-含坑.pdf"

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))

text = SRC.read_text(encoding="utf-8")
lines = []
for raw in text.splitlines():
    if not raw.strip():
        lines.append("")
        continue
    while len(raw) > 34:
        lines.append(raw[:34])
        raw = raw[34:]
    lines.append(raw)

c = canvas.Canvas(str(OUT), pagesize=A4)
width, height = A4
top, bottom = height - 60, 50
y = top
c.setFont("STSong-Light", 11)
for line in lines:
    if y < bottom:
        c.showPage()
        c.setFont("STSong-Light", 11)
        y = top
    c.drawString(48, y, line)
    y -= 17
c.save()
print("wrote", OUT, OUT.stat().st_size, "bytes,", len(lines), "lines")
