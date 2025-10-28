import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/postgres";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle
} from "docx";
import fs from 'node:fs/promises';
import path from 'node:path';

// --- HELPER UNTUK GAMBAR & NAMA FILE ---

async function fetchImage(url: string): Promise<Buffer | undefined> {
    try {
        const response = await fetch(url); 
        if (!response.ok) {
            console.error(`Gagal fetch image: ${response.status} ${response.statusText}`);
            return undefined;
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (error) {
        console.error("Error fetching image:", error);
        return undefined;
    }
}

async function readDefaultLogo(): Promise<Buffer | undefined> {
    try {
        const logoPath = path.join(process.cwd(), 'public', 'logo_tsat.png');
        const logoBuffer = await fs.readFile(logoPath);
        return logoBuffer;
    } catch (error) {
        console.error("Error reading default logo (logo_tsat.png):", error);
        return undefined;
    }
}

function sanitizeFileName(name: string): string {
    if (!name) return "";
    return name.trim().replace(/[\\/:*?"<>|]/g, '_');
}


// --- PARSER KONTEN TIPTAP ---

interface TiptapNode {
  type: string;
  content?: TiptapNode[];
  text?: string;
  marks?: { type: string }[];
  attrs?: { src?: string; [key: string]: any };
}

async function nodeToDocx(node: TiptapNode): Promise<Paragraph[]> {
    const elements: Paragraph[] = [];

    switch (node.type) {
        case 'paragraph':
            const textRuns: TextRun[] = [];
            if (node.content) {
                for (const child of node.content) {
                    if (child.type === 'text' && child.text) {
                        textRuns.push(new TextRun({
                            text: child.text || "",
                            bold: child.marks?.some(m => m.type === 'bold'),
                            italics: child.marks?.some(m => m.type === 'italic'),
                        }));
                    }
                }
            }
            if (textRuns.length === 0) {
                 textRuns.push(new TextRun(""));
            }
            elements.push(new Paragraph({ children: textRuns }));
            break;

        case 'image':
            if (node.attrs?.src) {
                const imgBuffer = await fetchImage(node.attrs.src);
                if (imgBuffer) {
                    elements.push(new Paragraph({
                        children: [new ImageRun({
                            data: imgBuffer.toString("base64"),
                            transformation: { width: 450, height: 300 } 
                        } as any)],
                        alignment: AlignmentType.CENTER
                    }));
                }
            }
            break;
        
        default:
            if (node.text) {
                 elements.push(new Paragraph({ children: [new TextRun(node.text)] }));
            }
            break;
    }

    return elements;
}

async function parseTiptapContent(sections: any[]): Promise<Paragraph[]> {
    const allElements: Paragraph[] = [];

    if (!Array.isArray(sections)) {
        return allElements;
    }

    for (const section of sections) {
        allElements.push(new Paragraph({
            children: [new TextRun({ text: section.label, bold: true })],
            spacing: { after: 200 }
        }));

        const tiptapJson = section.content as TiptapNode;
        
        if (tiptapJson && Array.isArray(tiptapJson.content)) {
            for (const node of tiptapJson.content) {
                const docxElements = await nodeToDocx(node);
                allElements.push(...docxElements);
            }
        }
    }
    return allElements;
}

// --- API ROUTE UTAMA ---

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const momId = body.momId;

    if (!momId) {
      return NextResponse.json({ error: "MOM ID is required" }, { status: 400 });
    }

    const momData = await prisma.mom.findUnique({
      where: { id: parseInt(momId as string) },
      include: {
        company: true,
        approvers: true,
        attachments: { include: { files: true } },
        next_actions: true,
      },
    });

    if (!momData) {
      return NextResponse.json({ error: "MOM not found" }, { status: 404 });
    }

    const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
        momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
        readDefaultLogo()
    ]);

    const parsedContentElements = await parseTiptapContent(momData.content as any[] || []);

    // ▶️ DEFINISI STYLE BORDER
    const thinBlackBorder = { style: BorderStyle.SINGLE, size: 1, color: "000000" };
    const noBorder = { style: BorderStyle.NONE, size: 0, color: "auto" };

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                  // --- BARIS 1 ---
                  new TableRow({
                      children: [
                          // Kolom Kiri (Logo T-Sat)
                          new TableCell({
                              verticalAlign: VerticalAlign.CENTER,
                              children: defaultLogoBuffer
                                ? [new Paragraph({
                                    alignment: AlignmentType.CENTER,
                                    children: [new ImageRun({
                                        data: defaultLogoBuffer.toString("base64"),
                                        transformation: { width: 120, height: 60 }
                                    } as any)],
                                  })]
                                : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })],
                              width: { size: 25, type: WidthType.PERCENTAGE },
                              verticalMerge: "restart",
                              // ▶️ TAMBAHKAN BORDER
                              borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }
                          }),
                          // Kolom Tengah (Judul)
                          new TableCell({
                              children: [
                                  new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }),
                                  new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }),
                              ],
                              width: { size: 50, type: WidthType.PERCENTAGE },
                              // ▶️ TAMBAHKAN BORDER
                              borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }
                          }),
                          // Kolom Kanan (Logo Mitra)
                          new TableCell({
                              verticalAlign: VerticalAlign.CENTER,
                              children: companyLogoApiBuffer
                                ? [new Paragraph({
                                    alignment: AlignmentType.CENTER,
                                    children: [new ImageRun({
                                        data: companyLogoApiBuffer.toString("base64"),
                                        transformation: { width: 120, height: 60 }
                                    } as any)],
                                  })]
                                : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })],
                              width: { size: 25, type: WidthType.PERCENTAGE },
                              verticalMerge: "restart",
                              // ▶️ TAMBAHKAN BORDER
                              borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }
                          }),
                      ],
                  }),
                  // --- BARIS 2 ---
                  new TableRow({
                      children: [
                          // Kolom Kiri (Lanjutan Merge)
                          new TableCell({ 
                            children: [], 
                            verticalMerge: "continue",
                            // ▶️ TAMBAHKAN BORDER
                            borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }
                          }),
                          // Kolom Tengah (Detail)
                          new TableCell({
                              children: [
                                  new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }),
                                  new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }),
                                  new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }),
                              ],
                              // ▶️ TAMBAHKAN BORDER (Hapus border atas agar menyatu)
                              borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }
                          }),
                          // Kolom Kanan (Lanjutan Merge)
                          new TableCell({ 
                            children: [], 
                            verticalMerge: "continue",
                            // ▶️ TAMBAHKAN BORDER
                            borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }
                          }),
                      ],
                  }),
              ],
          }),

          new Paragraph({ text: "" }),
          new Paragraph({ text: "Attendees: ..." }),
          new Paragraph({ text: "Result", heading: HeadingLevel.HEADING_6, alignment: AlignmentType.CENTER }),
          new Paragraph({ text: "Description", alignment: AlignmentType.CENTER }),

          ...parsedContentElements,

          new Paragraph({ 
            children: [
              new TextRun({ text: "Next Action", bold: true })
            ] 
          }),
          new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                  new TableRow({
                      children: [
                          new TableCell({ children: [new Paragraph("No")] }),
                          new TableCell({ children: [new Paragraph("Action")] }),
                          new TableCell({ children: [new Paragraph("Due Date")] }),
                          new TableCell({ children: [new Paragraph("UIC")] }),
                      ]
                  }),
                  ...(momData.next_actions || []).map((action, index) => new TableRow({
                      children: [
                          new TableCell({ children: [new Paragraph(String(index + 1))] }),
                          new TableCell({ children: [new Paragraph(action.action)] }),
                          new TableCell({ children: [new Paragraph(action.target)] }),
                          new TableCell({ children: [new Paragraph(action.pic)] }),
                      ]
                  }))
              ]
          }),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);

    const momTitleSanitized = sanitizeFileName((momData as any).title || 'MOM');
    const companyNameSanitized = sanitizeFileName(momData.company?.name || 'Generated');
    const fileName = `MOM-${momTitleSanitized}-${companyNameSanitized}.docx`;

    return new NextResponse(Uint8Array.from(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });

  } catch (error: any) {
    console.error("Error generating DOCX:", error);
    return NextResponse.json({ error: "Failed to generate DOCX", details: error.message }, { status: 500 });
  }
}

// import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma/postgres";
// import {
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign
// } from "docx";
// import fs from 'node:fs/promises';
// import path from 'node:path';

// // --- HELPER UNTUK GAMBAR & NAMA FILE ---

// async function fetchImage(url: string): Promise<Buffer | undefined> {
//     try {
//         const response = await fetch(url); 
//         if (!response.ok) {
//             console.error(`Gagal fetch image: ${response.status} ${response.statusText}`);
//             return undefined;
//         }
//         const arrayBuffer = await response.arrayBuffer();
//         return Buffer.from(arrayBuffer);
//     } catch (error) {
//         console.error("Error fetching image:", error);
//         return undefined;
//     }
// }

// async function readDefaultLogo(): Promise<Buffer | undefined> {
//     try {
//         const logoPath = path.join(process.cwd(), 'public', 'logo_tsat.png');
//         const logoBuffer = await fs.readFile(logoPath);
//         return logoBuffer;
//     } catch (error) {
//         console.error("Error reading default logo (logo_tsat.png):", error);
//         return undefined;
//     }
// }

// function sanitizeFileName(name: string): string {
//     if (!name) return "";
//     return name.trim().replace(/[\\/:*?"<>|]/g, '_');
// }


// // --- PARSER KONTEN TIPTAP ---

// // Tipe data sederhana untuk node Tiptap
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; [key: string]: any };
// }

// /**
//  * Mengubah satu node Tiptap (seperti paragraf atau gambar) menjadi elemen docx
//  * Ini async karena gambar perlu di-fetch
//  */
// async function nodeToDocx(node: TiptapNode): Promise<Paragraph[]> {
//     const elements: Paragraph[] = [];

//     switch (node.type) {
//         case 'paragraph':
//             const textRuns: TextRun[] = [];
//             if (node.content) {
//                 for (const child of node.content) {
//                     if (child.type === 'text' && child.text) {
//                         textRuns.push(new TextRun({
//                             text: child.text || "",
//                             bold: child.marks?.some(m => m.type === 'bold'),
//                             italics: child.marks?.some(m => m.type === 'italic'),
//                         }));
//                     }
//                 }
//             }
//             // Tambahkan paragraf kosong jika tidak ada teks
//             if (textRuns.length === 0) {
//                  textRuns.push(new TextRun(""));
//             }
//             elements.push(new Paragraph({ children: textRuns }));
//             break;

//         case 'image':
//             if (node.attrs?.src) {
//                 const imgBuffer = await fetchImage(node.attrs.src);
//                 if (imgBuffer) {
//                     elements.push(new Paragraph({
//                         children: [new ImageRun({
//                             data: imgBuffer.toString("base64"),
//                             // Atur ukuran gambar sesuai kebutuhan
//                             transformation: { width: 450, height: 300 } 
//                         } as any)],
//                         alignment: AlignmentType.CENTER
//                     }));
//                 }
//             }
//             break;
        
//         // TODO: Tambahkan case untuk 'bulletList', 'orderedList', 'table', 'heading'

//         // Fallback untuk node lain yang mungkin hanya berisi teks
//         default:
//             if (node.text) {
//                  elements.push(new Paragraph({ children: [new TextRun(node.text)] }));
//             }
//             break;
//     }

//     return elements;
// }

// /**
//  * Mem-parsing semua bagian konten (Latar Belakang, Pembahasan, dll)
//  */
// async function parseTiptapContent(sections: any[]): Promise<Paragraph[]> {
//     const allElements: Paragraph[] = [];

//     if (!Array.isArray(sections)) {
//         return allElements;
//     }

//     for (const section of sections) {
//         // 1. Tambahkan Judul Section (misal: "Latar Belakang")
//         allElements.push(new Paragraph({
//             children: [new TextRun({ text: section.label, bold: true })],
//             spacing: { after: 200 }
//         }));

//         // 2. Parse konten JSON dari Tiptap
//         const tiptapJson = section.content as TiptapNode; // Root: {"type":"doc", "content": [...]}
        
//         if (tiptapJson && Array.isArray(tiptapJson.content)) {
//             for (const node of tiptapJson.content) {
//                 const docxElements = await nodeToDocx(node);
//                 allElements.push(...docxElements);
//             }
//         }
//     }
//     return allElements;
// }

// // --- API ROUTE UTAMA ---

// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) {
//       return NextResponse.json({ error: "MOM ID is required" }, { status: 400 });
//     }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         approvers: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) {
//       return NextResponse.json({ error: "MOM not found" }, { status: 404 });
//     }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     // Panggil parser Tiptap SEBELUM membuat dokumen
//     const parsedContentElements = await parseTiptapContent(momData.content as any[] || []);

//     const doc = new Document({
//       sections: [{
//         properties: {},
//         children: [
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({
//                               verticalAlign: VerticalAlign.CENTER,
//                               children: defaultLogoBuffer
//                                 ? [new Paragraph({
//                                     alignment: AlignmentType.CENTER,
//                                     children: [new ImageRun({
//                                         data: defaultLogoBuffer.toString("base64"),
//                                         transformation: { width: 120, height: 60 }
//                                     } as any)],
//                                   })]
//                                 : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }),
//                                   new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }),
//                               ],
//                               width: { size: 50, type: WidthType.PERCENTAGE },
//                           }),
//                           new TableCell({
//                               verticalAlign: VerticalAlign.CENTER,
//                               children: companyLogoApiBuffer
//                                 ? [new Paragraph({
//                                     alignment: AlignmentType.CENTER,
//                                     children: [new ImageRun({
//                                         data: companyLogoApiBuffer.toString("base64"),
//                                         transformation: { width: 120, height: 60 }
//                                     } as any)],
//                                   })]
//                                 : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                       ],
//                   }),
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }),
//                                   new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }),
//                                   new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }),
//                               ],
//                           }),
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                       ],
//                   }),
//               ],
//           }),

//           new Paragraph({ text: "" }),
//           new Paragraph({ text: "Attendees: ..." }),
//           new Paragraph({ text: "Result", heading: HeadingLevel.HEADING_6, alignment: AlignmentType.CENTER }),
//           new Paragraph({ text: "Description", alignment: AlignmentType.CENTER }),

//           // ▶️ PERUBAHAN DI SINI: Masukkan elemen-elemen yang sudah diparsing
//           ...parsedContentElements,

//           new Paragraph({ 
//             children: [
//               new TextRun({ text: "Next Action", bold: true })
//             ] 
//           }),
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph("No")] }),
//                           new TableCell({ children: [new Paragraph("Action")] }),
//                           new TableCell({ children: [new Paragraph("Due Date")] }),
//                           new TableCell({ children: [new Paragraph("UIC")] }),
//                       ]
//                   }),
//                   ...(momData.next_actions || []).map((action, index) => new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph(String(index + 1))] }),
//                           new TableCell({ children: [new Paragraph(action.action)] }),
//                           new TableCell({ children: [new Paragraph(action.target)] }),
//                           new TableCell({ children: [new Paragraph(action.pic)] }),
//                       ]
//                   }))
//               ]
//           }),
//         ],
//       }],
//     });

//     const buffer = await Packer.toBuffer(doc);

//     const momTitleSanitized = sanitizeFileName((momData as any).title || 'MOM');
//     const companyNameSanitized = sanitizeFileName(momData.company?.name || 'Generated');
//     const fileName = `MOM-${momTitleSanitized}-${companyNameSanitized}.docx`;

//     return new NextResponse(Uint8Array.from(buffer), {
//       status: 200,
//       headers: {
//         "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//         "Content-Disposition": `attachment; filename="${fileName}"`,
//       },
//     });

//   } catch (error: any) {
//     console.error("Error generating DOCX:", error);
//     return NextResponse.json({ error: "Failed to generate DOCX", details: error.message }, { status: 500 });
//   }
// }

// import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma/postgres";
// import {
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign
// } from "docx";
// import fs from 'node:fs/promises';
// import path from 'node:path';

// async function fetchImage(url: string): Promise<Buffer | undefined> {
//     try {
//         const response = await fetch(url); 
//         if (!response.ok) {
//             console.error(`Gagal fetch image: ${response.status} ${response.statusText}`);
//             return undefined;
//         }
//         const arrayBuffer = await response.arrayBuffer();
//         return Buffer.from(arrayBuffer);
//     } catch (error) {
//         console.error("Error fetching image:", error);
//         return undefined;
//     }
// }

// async function readDefaultLogo(): Promise<Buffer | undefined> {
//     try {
//         const logoPath = path.join(process.cwd(), 'public', 'logo_tsat.png');
//         const logoBuffer = await fs.readFile(logoPath);
//         return logoBuffer;
//     } catch (error) {
//         console.error("Error reading default logo (logo_tsat.png):", error);
//         return undefined;
//     }
// }

// function sanitizeFileName(name: string): string {
//     if (!name) return "";
//     return name.trim().replace(/[\\/:*?"<>|]/g, '_');
// }

// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) {
//       return NextResponse.json({ error: "MOM ID is required" }, { status: 400 });
//     }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         approvers: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) {
//       return NextResponse.json({ error: "MOM not found" }, { status: 404 });
//     }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const doc = new Document({
//       sections: [{
//         properties: {},
//         children: [
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({
//                               verticalAlign: VerticalAlign.CENTER,
//                               children: defaultLogoBuffer
//                                 ? [new Paragraph({
//                                     alignment: AlignmentType.CENTER,
//                                     children: [new ImageRun({
//                                         data: defaultLogoBuffer.toString("base64"),
//                                         transformation: { width: 120, height: 60 }
//                                     } as any)],
//                                   })]
//                                 : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }),
//                                   new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }),
//                               ],
//                               width: { size: 50, type: WidthType.PERCENTAGE },
//                           }),
//                           new TableCell({
//                               verticalAlign: VerticalAlign.CENTER,
//                               children: companyLogoApiBuffer
//                                 ? [new Paragraph({
//                                     alignment: AlignmentType.CENTER,
//                                     children: [new ImageRun({
//                                         data: companyLogoApiBuffer.toString("base64"),
//                                         transformation: { width: 120, height: 60 }
//                                     } as any)],
//                                   })]
//                                 : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                       ],
//                   }),
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }),
//                                   new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }),
//                                   new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }),
//                               ],
//                           }),
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                       ],
//                   }),
//               ],
//           }),

//           new Paragraph({ text: "" }),
//           new Paragraph({ text: "Attendees: ..." }),
//           new Paragraph({ text: "Result", heading: HeadingLevel.HEADING_6, alignment: AlignmentType.CENTER }),
//           new Paragraph({ text: "Description", alignment: AlignmentType.CENTER }),

//           ...(momData.content as any[] || []).map((section: any) => {
//               return new Paragraph({
//                   children: [
//                       new TextRun({ text: section.label, bold: true }),
//                       new TextRun({ text: JSON.stringify(section.content), break: 1 }),
//                   ],
//                   spacing: { after: 200 }
//               });
//           }),

//           new Paragraph({ 
//             children: [
//               new TextRun({ text: "Next Action", bold: true })
//             ] 
//           }),
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph("No")] }),
//                           new TableCell({ children: [new Paragraph("Action")] }),
//                           new TableCell({ children: [new Paragraph("Due Date")] }),
//                           new TableCell({ children: [new Paragraph("UIC")] }),
//                       ]
//                   }),
//                   ...(momData.next_actions || []).map((action, index) => new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph(String(index + 1))] }),
//                           new TableCell({ children: [new Paragraph(action.action)] }),
//                           new TableCell({ children: [new Paragraph(action.target)] }),
//                           new TableCell({ children: [new Paragraph(action.pic)] }),
//                       ]
//                   }))
//               ]
//           }),
//         ],
//       }],
//     });

//     const buffer = await Packer.toBuffer(doc);

//     const momTitleSanitized = sanitizeFileName(momData.title || 'MOM');
//     const companyNameSanitized = sanitizeFileName(momData.company?.name || 'Generated');
//     const fileName = `MOM-${momTitleSanitized}-${companyNameSanitized}.docx`;

//     return new NextResponse(Uint8Array.from(buffer), {
//       status: 200,
//       headers: {
//         "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//         "Content-Disposition": `attachment; filename="${fileName}"`,
//       },
//     });

//   } catch (error: any) {
//     console.error("Error generating DOCX:", error);
//     return NextResponse.json({ error: "Failed to generate DOCX", details: error.message }, { status: 500 });
//   }
// }

// import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma/postgres";
// import {
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign
// } from "docx";
// import fs from 'node:fs/promises';
// import path from 'node:path';

// async function fetchImage(url: string): Promise<Buffer | undefined> {
//     try {
//         const response = await fetch(url);
//         if (!response.ok) {
//             console.error(`Gagal fetch image: ${response.status} ${response.statusText}`);
//             return undefined;
//         }
//         const arrayBuffer = await response.arrayBuffer();
//         return Buffer.from(arrayBuffer);
//     } catch (error) {
//         console.error("Error fetching image:", error);
//         return undefined;
//     }
// }

// async function readDefaultLogo(): Promise<Buffer | undefined> {
//     try {
//         const logoPath = path.join(process.cwd(), 'public', 'logo_tsat.png');
//         const logoBuffer = await fs.readFile(logoPath);
//         return logoBuffer;
//     } catch (error) {
//         console.error("Error reading default logo (logo_tsat.png):", error);
//         return undefined;
//     }
// }

// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) {
//       return NextResponse.json({ error: "MOM ID is required" }, { status: 400 });
//     }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         approvers: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) {
//       return NextResponse.json({ error: "MOM not found" }, { status: 404 });
//     }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const doc = new Document({
//       sections: [{
//         properties: {},
//         children: [
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({
//                               // ▶️ UBAH DISINI: Tambah verticalAlign & pastikan alignment center di Paragraph
//                               verticalAlign: VerticalAlign.CENTER,
//                               children: defaultLogoBuffer
//                                 ? [new Paragraph({
//                                     alignment: AlignmentType.CENTER, // Tengahkan paragraph
//                                     children: [new ImageRun({
//                                         data: defaultLogoBuffer.toString("base64"),
//                                         transformation: { width: 120, height: 60 }
//                                     } as any)],
//                                   })]
//                                 : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }),
//                                   new Paragraph({ text: `Joint Planning Session ${momData.company?.name || ''} & LEN`, alignment: AlignmentType.CENTER }),
//                               ],
//                               width: { size: 50, type: WidthType.PERCENTAGE },
//                           }),
//                           new TableCell({
//                                // ▶️ UBAH DISINI: Tambah verticalAlign & pastikan alignment center di Paragraph
//                               verticalAlign: VerticalAlign.CENTER,
//                               children: companyLogoApiBuffer
//                                 ? [new Paragraph({
//                                     alignment: AlignmentType.CENTER, // Tengahkan paragraph
//                                     children: [new ImageRun({
//                                         data: companyLogoApiBuffer.toString("base64"),
//                                         transformation: { width: 120, height: 60 }
//                                     } as any)],
//                                   })]
//                                 : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                       ],
//                   }),
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }),
//                                   new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }),
//                                   new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }),
//                               ],
//                           }),
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                       ],
//                   }),
//               ],
//           }),

//           new Paragraph({ text: "" }),
//           new Paragraph({ text: "Attendees: ..." }),
//           new Paragraph({ text: "Result", heading: HeadingLevel.HEADING_6, alignment: AlignmentType.CENTER }),
//           new Paragraph({ text: "Description", alignment: AlignmentType.CENTER }),

//           ...(momData.content as any[] || []).map((section: any) => {
//               return new Paragraph({
//                   children: [
//                       new TextRun({ text: section.label, bold: true }),
//                       new TextRun({ text: JSON.stringify(section.content), break: 1 }),
//                   ],
//                   spacing: { after: 200 }
//               });
//           }),

//           new Paragraph({
//             children: [
//               new TextRun({ text: "Next Action", bold: true })
//             ]
//           }),
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph("No")] }),
//                           new TableCell({ children: [new Paragraph("Action")] }),
//                           new TableCell({ children: [new Paragraph("Due Date")] }),
//                           new TableCell({ children: [new Paragraph("UIC")] }),
//                       ]
//                   }),
//                   ...(momData.next_actions || []).map((action, index) => new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph(String(index + 1))] }),
//                           new TableCell({ children: [new Paragraph(action.action)] }),
//                           new TableCell({ children: [new Paragraph(action.target)] }),
//                           new TableCell({ children: [new Paragraph(action.pic)] }),
//                       ]
//                   }))
//               ]
//           }),
//         ],
//       }],
//     });

//     const buffer = await Packer.toBuffer(doc);

//     const companyNameRaw = (momData.company?.name || 'Generated');
//     const companyNameTrimmed = companyNameRaw.trim();
//     const companyNameSanitized = companyNameTrimmed.replace(/[\\/:*?"<>|]/g, '_');
//     const fileName = `MOM_${companyNameSanitized}.docx`;

//     return new NextResponse(Uint8Array.from(buffer), {
//       status: 200,
//       headers: {
//         "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//         "Content-Disposition": `attachment; filename="${fileName}"`,
//       },
//     });

//   } catch (error: any) {
//     console.error("Error generating DOCX:", error);
//     return NextResponse.json({ error: "Failed to generate DOCX", details: error.message }, { status: 500 });
//   }
// }

// import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma/postgres";
// import {
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun
// } from "docx";
// import fs from 'node:fs/promises';
// import path from 'node:path';

// async function fetchImage(url: string): Promise<Buffer | undefined> {
//     try {
//         const response = await fetch(url);
//         if (!response.ok) {
//             console.error(`Gagal fetch image: ${response.status} ${response.statusText}`);
//             return undefined;
//         }
//         const arrayBuffer = await response.arrayBuffer();
//         return Buffer.from(arrayBuffer);
//     } catch (error) {
//         console.error("Error fetching image:", error);
//         return undefined;
//     }
// }

// async function readDefaultLogo(): Promise<Buffer | undefined> {
//     try {
//         const logoPath = path.join(process.cwd(), 'public', 'logo_tsat.png');
//         const logoBuffer = await fs.readFile(logoPath);
//         return logoBuffer;
//     } catch (error) {
//         console.error("Error reading default logo (logo_tsat.png):", error);
//         return undefined;
//     }
// }

// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) {
//       return NextResponse.json({ error: "MOM ID is required" }, { status: 400 });
//     }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         approvers: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) {
//       return NextResponse.json({ error: "MOM not found" }, { status: 404 });
//     }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const doc = new Document({
//       sections: [{
//         properties: {},
//         children: [
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({
//                               children: defaultLogoBuffer
//                                 ? [new Paragraph({
//                                     // ▶️ UBAH DISINI: Tambah alignment center & perbesar ukuran
//                                     alignment: AlignmentType.CENTER,
//                                     children: [new ImageRun({
//                                         data: defaultLogoBuffer.toString("base64"),
//                                         transformation: { width: 120, height: 60 } // Contoh: Ukuran diperbesar
//                                     } as any)],
//                                   })]
//                                 : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }),
//                                   new Paragraph({ text: `Joint Planning Session ${momData.company?.name || ''} & LEN`, alignment: AlignmentType.CENTER }),
//                               ],
//                               width: { size: 50, type: WidthType.PERCENTAGE },
//                           }),
//                           new TableCell({
//                               children: companyLogoApiBuffer
//                                 ? [new Paragraph({
//                                      // ▶️ UBAH DISINI: Tambah alignment center & perbesar ukuran
//                                     alignment: AlignmentType.CENTER,
//                                     children: [new ImageRun({
//                                         data: companyLogoApiBuffer.toString("base64"),
//                                         transformation: { width: 120, height: 60 } // Contoh: Ukuran diperbesar
//                                     } as any)],
//                                   })]
//                                 : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                       ],
//                   }),
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }),
//                                   new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }),
//                                   new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }),
//                               ],
//                           }),
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                       ],
//                   }),
//               ],
//           }),

//           new Paragraph({ text: "" }),
//           new Paragraph({ text: "Attendees: ..." }),
//           new Paragraph({ text: "Result", heading: HeadingLevel.HEADING_6, alignment: AlignmentType.CENTER }),
//           new Paragraph({ text: "Description", alignment: AlignmentType.CENTER }),

//           ...(momData.content as any[] || []).map((section: any) => {
//               return new Paragraph({
//                   children: [
//                       new TextRun({ text: section.label, bold: true }),
//                       new TextRun({ text: JSON.stringify(section.content), break: 1 }),
//                   ],
//                   spacing: { after: 200 }
//               });
//           }),

//           new Paragraph({
//             children: [
//               new TextRun({ text: "Next Action", bold: true })
//             ]
//           }),
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph("No")] }),
//                           new TableCell({ children: [new Paragraph("Action")] }),
//                           new TableCell({ children: [new Paragraph("Due Date")] }),
//                           new TableCell({ children: [new Paragraph("UIC")] }),
//                       ]
//                   }),
//                   ...(momData.next_actions || []).map((action, index) => new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph(String(index + 1))] }),
//                           new TableCell({ children: [new Paragraph(action.action)] }),
//                           new TableCell({ children: [new Paragraph(action.target)] }),
//                           new TableCell({ children: [new Paragraph(action.pic)] }),
//                       ]
//                   }))
//               ]
//           }),
//         ],
//       }],
//     });

//     const buffer = await Packer.toBuffer(doc);

//     const companyNameRaw = (momData.company?.name || 'Generated');
//     const companyNameTrimmed = companyNameRaw.trim();
//     const companyNameSanitized = companyNameTrimmed.replace(/[\\/:*?"<>|]/g, '_');
//     const fileName = `MOM_${companyNameSanitized}.docx`;

//     return new NextResponse(Uint8Array.from(buffer), {
//       status: 200,
//       headers: {
//         "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//         "Content-Disposition": `attachment; filename="${fileName}"`,
//       },
//     });

//   } catch (error: any) {
//     console.error("Error generating DOCX:", error);
//     return NextResponse.json({ error: "Failed to generate DOCX", details: error.message }, { status: 500 });
//   }
// }

// import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma/postgres";
// import {
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun
// } from "docx";
// import fs from 'node:fs/promises';
// import path from 'node:path';

// async function fetchImage(url: string): Promise<Buffer | undefined> {
//     try {
//         const response = await fetch(url); 
//         if (!response.ok) {
//             console.error(`Gagal fetch image: ${response.status} ${response.statusText}`);
//             return undefined;
//         }
//         const arrayBuffer = await response.arrayBuffer();
//         return Buffer.from(arrayBuffer);
//     } catch (error) {
//         console.error("Error fetching image:", error);
//         return undefined;
//     }
// }

// async function readDefaultLogo(): Promise<Buffer | undefined> {
//     try {
//         const logoPath = path.join(process.cwd(), 'public', 'logo_tsat.png');
//         const logoBuffer = await fs.readFile(logoPath);
//         return logoBuffer;
//     } catch (error) {
//         console.error("Error reading default logo (logo_tsat.png):", error);
//         return undefined;
//     }
// }


// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) {
//       return NextResponse.json({ error: "MOM ID is required" }, { status: 400 });
//     }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         approvers: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) {
//       return NextResponse.json({ error: "MOM not found" }, { status: 404 });
//     }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);
    
//     const doc = new Document({
//       sections: [{
//         properties: {},
//         children: [
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({
//                               children: defaultLogoBuffer
//                                 ? [new Paragraph({
//                                     children: [new ImageRun({
//                                         data: defaultLogoBuffer.toString("base64"),
//                                         transformation: { width: 80, height: 40 }
//                                     } as any)],
//                                     alignment: AlignmentType.CENTER
//                                   })]
//                                 : [new Paragraph("Logo T-Sat")],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }),
//                                   new Paragraph({ text: `Joint Planning Session ${momData.company?.name || ''} & LEN`, alignment: AlignmentType.CENTER }),
//                               ],
//                               width: { size: 50, type: WidthType.PERCENTAGE },
//                           }),
//                           new TableCell({
//                               children: companyLogoApiBuffer
//                                 ? [new Paragraph({
//                                     children: [new ImageRun({
//                                         data: companyLogoApiBuffer.toString("base64"),
//                                         transformation: { width: 80, height: 40 }
//                                     } as any)],
//                                     alignment: AlignmentType.CENTER
//                                   })]
//                                 : [new Paragraph("Logo Mitra")],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                       ],
//                   }),
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }),
//                                   new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }),
//                                   new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }),
//                               ],
//                           }),
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                       ],
//                   }),
//               ],
//           }),

//           new Paragraph({ text: "" }),
//           new Paragraph({ text: "Attendees: ..." }),
//           new Paragraph({ text: "Result", heading: HeadingLevel.HEADING_6, alignment: AlignmentType.CENTER }),
//           new Paragraph({ text: "Description", alignment: AlignmentType.CENTER }),

//           ...(momData.content as any[] || []).map((section: any) => {
//               return new Paragraph({
//                   children: [
//                       new TextRun({ text: section.label, bold: true }),
//                       new TextRun({ text: JSON.stringify(section.content), break: 1 }),
//                   ],
//                   spacing: { after: 200 }
//               });
//           }),

//           new Paragraph({ 
//             children: [
//               new TextRun({ text: "Next Action", bold: true })
//             ] 
//           }),
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph("No")] }),
//                           new TableCell({ children: [new Paragraph("Action")] }),
//                           new TableCell({ children: [new Paragraph("Due Date")] }),
//                           new TableCell({ children: [new Paragraph("UIC")] }),
//                       ]
//                   }),
//                   ...(momData.next_actions || []).map((action, index) => new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph(String(index + 1))] }),
//                           new TableCell({ children: [new Paragraph(action.action)] }),
//                           new TableCell({ children: [new Paragraph(action.target)] }),
//                           new TableCell({ children: [new Paragraph(action.pic)] }),
//                       ]
//                   }))
//               ]
//           }),
//         ],
//       }],
//     });

//     const buffer = await Packer.toBuffer(doc);

//     const companyNameRaw = (momData.company?.name || 'Generated');
//     const companyNameTrimmed = companyNameRaw.trim();
//     const companyNameSanitized = companyNameTrimmed.replace(/[\\/:*?"<>|]/g, '_');
//     const fileName = `MOM_${companyNameSanitized}.docx`;

//     return new NextResponse(Uint8Array.from(buffer), {
//       status: 200,
//       headers: {
//         "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//         "Content-Disposition": `attachment; filename="${fileName}"`,
//       },
//     });

//   } catch (error: any) {
//     console.error("Error generating DOCX:", error);
//     return NextResponse.json({ error: "Failed to generate DOCX", details: error.message }, { status: 500 });
//   }
// }

// import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma/postgres";
// import {
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun
// } from "docx";
// import fs from 'node:fs/promises'; // Import modul File System
// import path from 'node:path';     // Import modul Path

// /**
//  * Mengambil gambar dari URL (untuk logo KANAN / dari API)
//  */
// async function fetchImage(url: string): Promise<Buffer | undefined> {
//     try {
//         const response = await fetch(url); 
//         if (!response.ok) {
//             console.error(`Gagal fetch image: ${response.status} ${response.statusText}`);
//             return undefined;
//         }
//         const arrayBuffer = await response.arrayBuffer();
//         return Buffer.from(arrayBuffer);
//     } catch (error) {
//         console.error("Error fetching image:", error);
//         return undefined;
//     }
// }

// /**
//  * Membaca logo default dari folder /public (untuk logo KIRI)
//  */
// async function readDefaultLogo(): Promise<Buffer | undefined> {
//     try {
//         const logoPath = path.join(process.cwd(), 'public', 'logo_tsat.png');
//         const logoBuffer = await fs.readFile(logoPath);
//         return logoBuffer;
//     } catch (error) {
//         console.error("Error reading default logo (logo_tsat.png):", error);
//         return undefined;
//     }
// }


// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) {
//       return NextResponse.json({ error: "MOM ID is required" }, { status: 400 });
//     }

//     // 1. Ambil data MOM dan relasi Company
//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true, // Untuk logo kanan (dari API)
//         approvers: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) {
//       return NextResponse.json({ error: "MOM not found" }, { status: 404 });
//     }

//     // 2. Ambil kedua logo secara paralel
//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);
    
//     // 3. Bangun Dokumen DOCX
//     const doc = new Document({
//       sections: [{
//         properties: {},
//         children: [
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   // BARIS PERTAMA: LOGO KIRI | JUDUL | LOGO KANAN
//                   new TableRow({
//                       children: [
//                           // Kolom Logo Kiri (Default)
//                           new TableCell({
//                               children: defaultLogoBuffer
//                                 ? [new Paragraph({
//                                     children: [new ImageRun({
//                                         data: defaultLogoBuffer.toString("base64"),
//                                         transformation: { width: 80, height: 40 }
//                                     } as any)],
//                                     alignment: AlignmentType.CENTER
//                                   })]
//                                 : [new Paragraph("Logo T-Sat")],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                           // Kolom Judul Tengah
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }),
//                                   new Paragraph({ text: `Joint Planning Session ${momData.company?.name || ''} & LEN`, alignment: AlignmentType.CENTER }),
//                               ],
//                               width: { size: 50, type: WidthType.PERCENTAGE },
//                           }),
//                           // Kolom Logo Kanan (dari API)
//                           new TableCell({
//                               children: companyLogoApiBuffer
//                                 ? [new Paragraph({
//                                     children: [new ImageRun({
//                                         data: companyLogoApiBuffer.toString("base64"),
//                                         transformation: { width: 80, height: 40 }
//                                     } as any)],
//                                     alignment: AlignmentType.CENTER
//                                   })]
//                                 : [new Paragraph("Logo Mitra")],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                       ],
//                   }),
//                   // BARIS KEDUA: DETAIL (DATE, TIME, VENUE)
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }),
//                                   new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }),
//                                   new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }),
//                               ],
//                           }),
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                       ],
//                   }),
//               ],
//           }),

//           // Sisa Dokumen
//           new Paragraph({ text: "" }),
//           new Paragraph({ text: "Attendees: ..." }), // Ganti dengan data jika ada
//           new Paragraph({ text: "Result", heading: HeadingLevel.HEADING_6, alignment: AlignmentType.CENTER }),
//           new Paragraph({ text: "Description", alignment: AlignmentType.CENTER }),

//           // Render Konten Tiptap (JSON)
//           ...(momData.content as any[] || []).map((section: any) => {
//               // TODO: Ini masih render JSON string. Perlu parser Tiptap ke docx.
//               return new Paragraph({
//                   children: [
//                       new TextRun({ text: section.label, bold: true }),
//                       new TextRun({ text: JSON.stringify(section.content), break: 1 }),
//                   ],
//                   spacing: { after: 200 }
//               });
//           }),

//           // Tabel Next Action
//           new Paragraph({ 
//             children: [
//               new TextRun({ text: "Next Action", bold: true })
//             ] 
//           }),
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph("No")] }),
//                           new TableCell({ children: [new Paragraph("Action")] }),
//                           new TableCell({ children: [new Paragraph("Due Date")] }),
//                           new TableCell({ children: [new Paragraph("UIC")] }),
//                       ]
//                   }),
//                   ...(momData.next_actions || []).map((action, index) => new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph(String(index + 1))] }),
//                           new TableCell({ children: [new Paragraph(action.action)] }),
//                           new TableCell({ children: [new Paragraph(action.target)] }),
//                           new TableCell({ children: [new Paragraph(action.pic)] }),
//                       ]
//                   }))
//               ]
//           }),
//         ],
//       }],
//     });

//     // 4. Generate buffer dan kirim respons
//     const buffer = await Packer.toBuffer(doc);

//     return new NextResponse(Uint8Array.from(buffer), {
//       status: 200,
//       headers: {
//         "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//         "Content-Disposition": `attachment; filename="MOM_${momData.company?.name || 'Generated'}.docx"`,
//       },
//     });

//   } catch (error: any) {
//     console.error("Error generating DOCX:", error);
//     return NextResponse.json({ error: "Failed to generate DOCX", details: error.message }, { status: 500 });
//   }
// }

// import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma/postgres";
// import {
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun
// } from "docx";

// async function fetchImage(url: string): Promise<Buffer | undefined> {
//     try {
//         const response = await fetch(url); 
//         if (!response.ok) return undefined;
//         const arrayBuffer = await response.arrayBuffer();
//         return Buffer.from(arrayBuffer);
//     } catch (error) {
//         console.error("Error fetching image:", error);
//         return undefined;
//     }
// }

// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) {
//       return NextResponse.json({ error: "MOM ID is required" }, { status: 400 });
//     }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         approvers: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) {
//       return NextResponse.json({ error: "MOM not found" }, { status: 404 });
//     }

//     const companyLogoBuffer = momData.company?.logo_mitra_url
//       ? await fetchImage(momData.company.logo_mitra_url)
//       : undefined;
    
//     // const lenLogoBuffer = ... 

//     const doc = new Document({
//       sections: [{
//         properties: {},
//         children: [
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({
//                               children: companyLogoBuffer
//                                 ? [new Paragraph({
//                                     // UBAH DI SINI: Gunakan 'as any' untuk memaksa TypeScript
//                                     children: [new ImageRun({ 
//                                         data: companyLogoBuffer.toString("base64"), 
//                                         transformation: { width: 80, height: 40 } 
//                                     } as any)], // <-- Perbaikan di sini
//                                     alignment: AlignmentType.CENTER
//                                   })]
//                                 : [new Paragraph("Logo Perusahaan")],
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }),
//                                   new Paragraph({ text: `Joint Planning Session ${momData.company?.name || ''} & LEN`, alignment: AlignmentType.CENTER }),
//                               ],
//                               width: { size: 50, type: WidthType.PERCENTAGE },
//                           }),
//                           new TableCell({
//                               children: [new Paragraph("Logo LEN")], 
//                               width: { size: 25, type: WidthType.PERCENTAGE },
//                               verticalMerge: "restart",
//                           }),
//                       ],
//                   }),
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                           new TableCell({
//                               children: [
//                                   new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }),
//                                   new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }),
//                                   new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }),
//                               ],
//                           }),
//                           new TableCell({ children: [], verticalMerge: "continue" }),
//                       ],
//                   }),
//               ],
//           }),

//           new Paragraph({ text: "" }),
//           new Paragraph({ text: "Attendees: ..." }),
//           new Paragraph({ text: "Result", heading: HeadingLevel.HEADING_6, alignment: AlignmentType.CENTER }),
//           new Paragraph({ text: "Description", alignment: AlignmentType.CENTER }),

//           ...(momData.content as any[] || []).map((section: any) => {
//               return new Paragraph({
//                   children: [
//                       new TextRun({ text: section.label, bold: true }),
//                       new TextRun({ text: JSON.stringify(section.content), break: 1 }),
//                   ],
//                   spacing: { after: 200 }
//               });
//           }),

//           new Paragraph({ 
//             children: [
//               new TextRun({ text: "Next Action", bold: true })
//             ] 
//           }),
//           new Table({
//               width: { size: 100, type: WidthType.PERCENTAGE },
//               rows: [
//                   new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph("No")] }),
//                           new TableCell({ children: [new Paragraph("Action")] }),
//                           new TableCell({ children: [new Paragraph("Due Date")] }),
//                           new TableCell({ children: [new Paragraph("UIC")] }),
//                       ]
//                   }),
//                   ...(momData.next_actions || []).map((action, index) => new TableRow({
//                       children: [
//                           new TableCell({ children: [new Paragraph(String(index + 1))] }),
//                           new TableCell({ children: [new Paragraph(action.action)] }),
//                           new TableCell({ children: [new Paragraph(action.target)] }),
//                           new TableCell({ children: [new Paragraph(action.pic)] }),
//                       ]
//                   }))
//               ]
//           }),
//         ],
//       }],
//     });

//     const buffer = await Packer.toBuffer(doc);

//     return new NextResponse(Uint8Array.from(buffer), {
//       status: 200,
//       headers: {
//         "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//         "Content-Disposition": `attachment; filename="MOM_${momData.company?.name || 'Generated'}.docx"`,
//       },
//     });

//   } catch (error: any) {
//     console.error("Error generating DOCX:", error);
//     return NextResponse.json({ error: "Failed to generate DOCX", details: error.message }, { status: 500 });
//   }
// }