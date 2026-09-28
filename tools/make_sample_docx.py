# -*- coding: utf-8 -*-
"""生成演示用 DOCX 合同（验证 OOXML 解析路径）。"""
from pathlib import Path
from docx import Document

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "samples" / "租房合同-规范对照.txt"
OUT = ROOT / "data" / "samples" / "租房合同-规范对照.docx"

doc = Document()
for line in SRC.read_text(encoding="utf-8").splitlines():
    if line.strip():
        doc.add_paragraph(line.strip())
doc.save(OUT)
print("wrote", OUT, OUT.stat().st_size)
