import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/postgres";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle, Header, Footer, PageNumber, IBorderOptions, ShadingType,
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

// --- Style Border ---
const thinBlackBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

// --- Cell Margins ---
const cellMargins = { top: 100, bottom: 100, left: 100, right: 100 };

// --- KONFIGURASI NUMBERING (LIST) ---
const numberingConfig = {
    config: [
        {
            reference: "my-bullet-points",
            levels: [
                {
                    level: 0,
                    format: "bullet" as const,
                    text: "\u2022",
                    alignment: AlignmentType.LEFT,
                    style: { paragraph: { indent: { left: 720, hanging: 360 } } },
                },
            ],
        },
        {
            reference: "my-ordered-list",
            levels: [
                {
                    level: 0,
                    format: "decimal" as const,
                    text: "%1.",
                    alignment: AlignmentType.LEFT,
                    style: { paragraph: { indent: { left: 720, hanging: 360 } } },
                },
            ],
        },
    ],
};

// --- PARSER KONTEN TIPTAP ---
interface TiptapNode {
  type: string;
  content?: TiptapNode[];
  text?: string;
  marks?: { type: string }[];
  attrs?: { src?: string; align?: 'left' | 'center' | 'right'; [key: string]: any };
}

async function nodeToDocx(node: TiptapNode, options: { isHeader?: boolean } = {}): Promise<(Paragraph | Table | Paragraph[]) | undefined> {
    
    const createTextRuns = (content: TiptapNode[] | undefined): TextRun[] => {
        const textRuns: TextRun[] = [];
        if (content) {
            for (const child of content) {
                if (child.type === 'text' && child.text) {
                    textRuns.push(new TextRun({
                        text: child.text || "",
                        bold: options.isHeader || child.marks?.some(m => m.type === 'bold'),
                        italics: child.marks?.some(m => m.type === 'italic'),
                    }));
                }
            }
        }
        return textRuns.length === 0 ? [new TextRun("")] : textRuns;
    };

    const getAlignment = (
      alignAttr?: 'left' | 'center' | 'right'
    ): (typeof AlignmentType)[keyof typeof AlignmentType] => {
        if (alignAttr === 'center') return AlignmentType.CENTER;
        if (alignAttr === 'right') return AlignmentType.RIGHT;
        return AlignmentType.LEFT;
    };

    switch (node.type) {
        case 'paragraph':
            return new Paragraph({ 
                children: createTextRuns(node.content),
                alignment: getAlignment(node.attrs?.align),
            });

        case 'bulletList':
        case 'orderedList':
            const listItems: Paragraph[] = [];
            if (node.content) {
                for (const listItemNode of node.content) { 
                    if (listItemNode.type === 'listItem' && listItemNode.content) {
                        for (const itemContent of listItemNode.content) {
                            if (itemContent.type === 'paragraph') {
                                listItems.push(new Paragraph({
                                    children: createTextRuns(itemContent.content),
                                    numbering: {
                                        reference: node.type === 'bulletList' ? "my-bullet-points" : "my-ordered-list",
                                        level: 0,
                                    },
                                    alignment: getAlignment(itemContent.attrs?.align),
                                }));
                            }
                        }
                    }
                }
            }
            return listItems;

        case 'image':
            if (node.attrs?.src) {
                const imgBuffer = await fetchImage(node.attrs.src);
                if (imgBuffer) {
                    return new Paragraph({
                        children: [new ImageRun({ data: imgBuffer.toString("base64"), transformation: { width: 450, height: 300 } } as any)],
                        alignment: getAlignment(node.attrs?.align),
                    });
                }
            }
            return undefined;

        case 'table':
            const tableRows: TableRow[] = [];
            if (node.content) { 
                for (const rowNode of node.content) { 
                    if (rowNode.type === 'tableRow' && rowNode.content) { 
                        const cells: TableCell[] = [];
                        for (const cellNode of rowNode.content) {
                            if (cellNode.type === 'tableCell' || cellNode.type === 'tableHeader') {
                                const isHeader = cellNode.type === 'tableHeader';
                                const cellParagraphs: Paragraph[] = [];
                                if (cellNode.content) {
                                    for (const cellContentNode of cellNode.content) {
                                        const docxElement = await nodeToDocx(cellContentNode, { isHeader: isHeader });
                                        if (docxElement) {
                                            if (Array.isArray(docxElement)) {
                                                cellParagraphs.push(...docxElement);
                                            } else if (docxElement instanceof Paragraph) {
                                                cellParagraphs.push(docxElement);
                                            }
                                        }
                                    }
                                }
                                cells.push(new TableCell({
                                    children: cellParagraphs.length === 0 ? [new Paragraph("")] : cellParagraphs,
                                    borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
                                    verticalAlign: VerticalAlign.CENTER,
                                    margins: cellMargins,
                                    shading: isHeader ? { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" } : undefined,
                                }));
                            }
                        }
                        tableRows.push(new TableRow({ children: cells }));
                    }
                }
            }
            return new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: tableRows,
                alignment: getAlignment(node.attrs?.align),
            });

        default:
            if (node.content) {
                return new Paragraph({ children: createTextRuns(node.content) });
            }
            return new Paragraph({ children: [new TextRun("")] });
    }
}

async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
    const tableCells: TableCell[] = [];
    if (!Array.isArray(sections)) { return tableCells; }
    
    for (const section of sections) {
        const sectionChildren: (Paragraph | Table)[] = [];
        sectionChildren.push(new Paragraph({ children: [new TextRun({ text: section.label, bold: true })], spacing: { after: 100 } }));

        const tiptapJson = section.content as TiptapNode;
        if (tiptapJson && Array.isArray(tiptapJson.content)) {
            for (const node of tiptapJson.content) {
                const docxElement = await nodeToDocx(node);
                if (docxElement) {
                    if (Array.isArray(docxElement)) {
                        sectionChildren.push(...docxElement);
                    } else {
                        sectionChildren.push(docxElement);
                    }
                }
            }
        } else {
            sectionChildren.push(new Paragraph(""));
        }

        tableCells.push(new TableCell({
            children: sectionChildren,
            borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
            columnSpan: 2,
            margins: cellMargins,
        }));
    }
    return tableCells;
}

// --- PARSER LAMPIRAN ---
async function parseAttachments(attachments: any[]): Promise<Table[]> {
    const attachmentContent: Paragraph[] = [];
    if (!Array.isArray(attachments) || attachments.length === 0) {
        return [];
    }
    attachmentContent.push(new Paragraph({
        children: [new TextRun({ text: "Lampiran", bold: true })],
        alignment: AlignmentType.LEFT,
        spacing: { before: 200, after: 100 }
    }));
    
    let index = 0;
    for (const section of attachments) {
        attachmentContent.push(new Paragraph({
            children: [new TextRun({ text: `${index + 1}. ${section.section_name}`, bold: false })],
            spacing: { after: 100 }
        }));

        if (Array.isArray(section.files)) {
            for (const file of section.files) {
                if (file.url) {
                    const imgBuffer = await fetchImage(file.url); 
                    if (imgBuffer) {
                        attachmentContent.push(new Paragraph({
                            children: [new ImageRun({
                                data: imgBuffer.toString("base64"),
                                transformation: { width: 450, height: 300 }
                            } as any)],
                            alignment: AlignmentType.CENTER,
                            spacing: { after: 100 }
                        }));
                    }
                }
            }
        }
        index++;
    }

    const attachmentTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        children: attachmentContent,
                        borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
                        margins: cellMargins,
                    })
                ]
            })
        ]
    });
    return [attachmentTable];
}
// --- AKHIR PARSER LAMPIRAN ---

// --- PARSER APPROVER ---
function createApproverTable(
  sortedCompanyNames: string[],
  groupedApprovers: { [key: string]: string[] }
): (Paragraph | Table)[] {
    if (sortedCompanyNames.length === 0) {
        return [];
    }

    const headerCells: TableCell[] = [];
    const nameCells: TableCell[] = [];
    const signatureCells: TableCell[] = [];
    
    let totalApprovers = 0;
    
    for (const companyName of sortedCompanyNames) {
        const approvers = groupedApprovers[companyName];
        if (!approvers || approvers.length === 0) continue;
        
        totalApprovers += approvers.length;

        // 1. Header Row Cell (Nama Perusahaan)
        headerCells.push(
            new TableCell({
                children: [new Paragraph({
                    children: [new TextRun({ text: companyName, bold: true })],
                    alignment: AlignmentType.CENTER,
                })],
                columnSpan: approvers.length,
                borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
                verticalAlign: VerticalAlign.CENTER,
                margins: cellMargins,
            })
        );

        // 2. Name Row Cells (Nama Approver)
        for (const name of approvers) {
            nameCells.push(
                new TableCell({
                    children: [new Paragraph({
                        children: [new TextRun({ text: name })],
                        alignment: AlignmentType.CENTER,
                    })],
                    borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
                    verticalAlign: VerticalAlign.CENTER,
                    margins: cellMargins,
                })
            );
        }

        // 3. Signature Row Cells (Tempat TTD)
        for (let i = 0; i < approvers.length; i++) {
            signatureCells.push(
                new TableCell({
                    children: [new Paragraph({ text: "", spacing: { before: 800, after: 800 } })], // Spasi untuk TTD
                    borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
                    verticalAlign: VerticalAlign.CENTER,
                })
            );
        }
    }

    if (totalApprovers === 0) {
      return [];
    }

    // Hitung lebar kolom
    const columnWidths = Array(totalApprovers).fill(Math.floor(100 / totalApprovers));

    const approverTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: columnWidths,
        rows: [
            new TableRow({ children: headerCells }),
            new TableRow({ children: signatureCells }), // Baris kosong untuk TTD
            new TableRow({ children: nameCells }),      // Baris untuk nama
        ]
    });
    
    // Kembalikan Judul dan Tabel
    return [
        new Paragraph({
            children: [new TextRun({ text: "Disetujui Oleh:", bold: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 200 }
        }),
        approverTable
    ];
}
// --- AKHIR PARSER APPROVER ---


// --- API ROUTE UTAMA ---
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const momId = body.momId;

    if (!momId) { return NextResponse.json({ error: "MOM ID is required" }, { status: 400 }); }

    const momData = await prisma.mom.findUnique({
      where: { id: parseInt(momId as string) },
      include: {
        company: true, 
        attachments: { include: { files: true } },
        next_actions: true,
        approvers: true, 
      },
    });

    if (!momData) { return NextResponse.json({ error: "MOM not found" }, { status: 404 }); }

    const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
        momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
        readDefaultLogo()
    ]);

    const parsedContentTableCells = await parseTiptapContent(momData.content as any[] || []);
    const attachmentTables = await parseAttachments(momData.attachments as any[]);

    // --- Logika Grup Approver ---
    const telkomsatCompanyName = "Telkomsat";
    const groupedApprovers: { [key: string]: string[] } = {};

    for (const approver of momData.approvers) {
      const companyName = approver.type === 'Internal' 
        ? telkomsatCompanyName 
        : momData.company?.name || 'Eksternal'; // Ambil nama perusahaan eksternal dari relasi
      
      if (!groupedApprovers[companyName]) {
        groupedApprovers[companyName] = [];
      }
      groupedApprovers[companyName].push(approver.name);
    }
    
    // Urutkan agar Telkomsat selalu di kiri
    const sortedCompanyNames = Object.keys(groupedApprovers).sort((a, b) => {
      if (a === telkomsatCompanyName && b !== telkomsatCompanyName) return -1;
      if (a !== telkomsatCompanyName && b === telkomsatCompanyName) return 1;
      return a.localeCompare(b);
    });

    // Buat elemen tabel approver
    const approverTableElements = createApproverTable(sortedCompanyNames, groupedApprovers);
    // --- Akhir Logika Grup Approver ---


    const attendeesText = momData.count_attendees || '(Tidak ada data peserta)';

    // --- HEADER DOCX ---
    const headerTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                children: [
                    new TableCell({ verticalAlign: VerticalAlign.CENTER, children: defaultLogoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: defaultLogoBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
                    new TableCell({ children: [ new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }), new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }), ], width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
                    new TableCell({ verticalAlign: VerticalAlign.CENTER, children: companyLogoApiBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: companyLogoApiBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
                ],
            }),
            new TableRow({
                children: [
                    new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
                    // --- PERBAIKAN TYPO DI BAWAH INI ---
                    new TableCell({ children: [ new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }), new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }), new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }), ], borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
                    // --- AKHIR PERBAIKAN TYPO ---
                    new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
                ],
            }),
        ],
    });
    // --- AKHIR HEADER DOCX ---

    // --- TABEL NEXT ACTION ---
    const nextActionTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [1000, 4000, 2500, 2500],
        rows: [
            new TableRow({ children: [
                new TableCell({ children: [new Paragraph("No")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
                new TableCell({ children: [new Paragraph("Action")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
                new TableCell({ children: [new Paragraph("Due Date")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
                new TableCell({ children: [new Paragraph("UIC")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
            ] }),
            ...(momData.next_actions || []).map((action: { action: string, target: string, pic: string }, index: number) => new TableRow({ children: [
                new TableCell({ children: [new Paragraph(String(index + 1))], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
                new TableCell({ children: [new Paragraph(action.action)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
                new TableCell({ children: [new Paragraph(action.target)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
                new TableCell({ children: [new Paragraph(action.pic)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
            ] }))
        ],
        borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder }
    });
    // --- AKHIR TABEL NEXT ACTION ---

    // --- TABEL UTAMA ---
    const mainContentTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            // BARIS 1: Attendees
            new TableRow({
                children: [
                    new TableCell({
                        children: [new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [new TextRun({ text: "Attendees", bold: true })]
                        })],
                        borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
                        verticalAlign: VerticalAlign.CENTER,
                        width: { size: 15, type: WidthType.PERCENTAGE },
                        margins: cellMargins,
                    }),
                    new TableCell({
                        children: [new Paragraph(attendeesText)],
                        borders: { top: thinBlackBorder, left: noBorder, bottom: thinBlackBorder, right: thinBlackBorder },
                        width: { size: 85, type: WidthType.PERCENTAGE },
                        verticalAlign: VerticalAlign.CENTER,
                        margins: cellMargins,
                    }),
                ]
            }),
            // BARIS 2: Result Title
            new TableRow({
                children: [
                    new TableCell({
                        children: [new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [new TextRun({ text: "Result", bold: true })]
                        })],
                        columnSpan: 2,
                        borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
                        margins: cellMargins,
                    }),
                ]
            }),
            // BARIS 3: Description Title
            new TableRow({
                children: [
                    new TableCell({
                        children: [new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [new TextRun({ text: "Description", bold: true })]
                        })],
                        columnSpan: 2,
                        borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
                        shading: { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" },
                        margins: cellMargins,
                    }),
                ]
            }),
            // BARIS 4 dst: Section Konten Tiptap
            ...parsedContentTableCells.map(cell => new TableRow({ children: [cell] })),
            
            // BARIS TERAKHIR KONTEN: Next Action Title
            new TableRow({
                children: [
                    new TableCell({
                        children: [new Paragraph({ children: [new TextRun({ text: "Next Action", bold: true })] })],
                        columnSpan: 2,
                        borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
                        margins: cellMargins,
                    })
                ]
            }),
             // BARIS SETELAH Next Action Title: Tabel Next Action
            new TableRow({
                children: [
                    new TableCell({
                        children: [nextActionTable],
                        columnSpan: 2,
                        borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
                        margins: cellMargins,
                    })
                ]
            })
        ]
    });
    // --- AKHIR TABEL UTAMA ---

    const doc = new Document({
      numbering: numberingConfig,
      sections: [{
        headers: { 
            default: new Header({ 
                children: [
                    headerTable,
                    new Paragraph({ text: "" })
                ] 
            }) 
        },
        footers: { default: new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], italics: true }), ], }), ], }) },
        
        properties: {
            page: {
                margin: {
                    top: 1440, 
                    right: 1440,
                    bottom: 1440,
                    left: 1440,
                }
            }
        },

        children: [
            mainContentTable,
            new Paragraph({ text: "", spacing: { before: 200 } }),
            ...approverTableElements, 
            new Paragraph({ text: "", spacing: { before: 400 } }), // Ini spasi antara approver & lampiran
            ...attachmentTables
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const momTitleSanitized = sanitizeFileName(momData.title || 'MOM');
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
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle, Header, Footer, PageNumber, IBorderOptions, ShadingType,
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

// // --- Style Border ---
// const thinBlackBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
// const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

// // --- Cell Margins ---
// const cellMargins = { top: 100, bottom: 100, left: 100, right: 100 };

// // --- KONFIGURASI NUMBERING (LIST) ---
// const numberingConfig = {
//     config: [
//         {
//             reference: "my-bullet-points",
//             levels: [
//                 {
//                     level: 0,
//                     format: "bullet" as const,
//                     text: "\u2022",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//         {
//             reference: "my-ordered-list",
//             levels: [
//                 {
//                     level: 0,
//                     format: "decimal" as const,
//                     text: "%1.",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//     ],
// };

// // --- PARSER KONTEN TIPTAP ---
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; align?: 'left' | 'center' | 'right'; [key: string]: any };
// }

// async function nodeToDocx(node: TiptapNode, options: { isHeader?: boolean } = {}): Promise<(Paragraph | Table | Paragraph[]) | undefined> {
    
//     const createTextRuns = (content: TiptapNode[] | undefined): TextRun[] => {
//         const textRuns: TextRun[] = [];
//         if (content) {
//             for (const child of content) {
//                 if (child.type === 'text' && child.text) {
//                     textRuns.push(new TextRun({
//                         text: child.text || "",
//                         bold: options.isHeader || child.marks?.some(m => m.type === 'bold'),
//                         italics: child.marks?.some(m => m.type === 'italic'),
//                     }));
//                 }
//             }
//         }
//         return textRuns.length === 0 ? [new TextRun("")] : textRuns;
//     };

//     const getAlignment = (
//       alignAttr?: 'left' | 'center' | 'right'
//     ): (typeof AlignmentType)[keyof typeof AlignmentType] => {
//         if (alignAttr === 'center') return AlignmentType.CENTER;
//         if (alignAttr === 'right') return AlignmentType.RIGHT;
//         return AlignmentType.LEFT;
//     };

//     switch (node.type) {
//         case 'paragraph':
//             return new Paragraph({ 
//                 children: createTextRuns(node.content),
//                 alignment: getAlignment(node.attrs?.align),
//             });

//         case 'bulletList':
//         case 'orderedList':
//             const listItems: Paragraph[] = [];
//             if (node.content) {
//                 for (const listItemNode of node.content) { 
//                     if (listItemNode.type === 'listItem' && listItemNode.content) {
//                         for (const itemContent of listItemNode.content) {
//                             if (itemContent.type === 'paragraph') {
//                                 listItems.push(new Paragraph({
//                                     children: createTextRuns(itemContent.content),
//                                     numbering: {
//                                         reference: node.type === 'bulletList' ? "my-bullet-points" : "my-ordered-list",
//                                         level: 0,
//                                     },
//                                     alignment: getAlignment(itemContent.attrs?.align),
//                                 }));
//                             }
//                         }
//                     }
//                 }
//             }
//             return listItems;

//         case 'image':
//             if (node.attrs?.src) {
//                 const imgBuffer = await fetchImage(node.attrs.src);
//                 if (imgBuffer) {
//                     return new Paragraph({
//                         children: [new ImageRun({ data: imgBuffer.toString("base64"), transformation: { width: 450, height: 300 } } as any)],
//                         alignment: getAlignment(node.attrs?.align),
//                     });
//                 }
//             }
//             return undefined;

//         case 'table':
//             const tableRows: TableRow[] = [];
//             if (node.content) { 
//                 for (const rowNode of node.content) { 
//                     if (rowNode.type === 'tableRow' && rowNode.content) { 
//                         const cells: TableCell[] = [];
//                         for (const cellNode of rowNode.content) {
//                             if (cellNode.type === 'tableCell' || cellNode.type === 'tableHeader') {
//                                 const isHeader = cellNode.type === 'tableHeader';
//                                 const cellParagraphs: Paragraph[] = [];
//                                 if (cellNode.content) {
//                                     for (const cellContentNode of cellNode.content) {
//                                         const docxElement = await nodeToDocx(cellContentNode, { isHeader: isHeader });
//                                         if (docxElement) {
//                                             if (Array.isArray(docxElement)) {
//                                                 cellParagraphs.push(...docxElement);
//                                             } else if (docxElement instanceof Paragraph) {
//                                                 cellParagraphs.push(docxElement);
//                                             }
//                                         }
//                                     }
//                                 }
//                                 cells.push(new TableCell({
//                                     children: cellParagraphs.length === 0 ? [new Paragraph("")] : cellParagraphs,
//                                     borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                                     verticalAlign: VerticalAlign.CENTER,
//                                     margins: cellMargins,
//                                     shading: isHeader ? { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" } : undefined,
//                                 }));
//                             }
//                         }
//                         tableRows.push(new TableRow({ children: cells }));
//                     }
//                 }
//             }
//             return new Table({
//                 width: { size: 100, type: WidthType.PERCENTAGE },
//                 rows: tableRows,
//                 alignment: getAlignment(node.attrs?.align),
//             });

//         default:
//             if (node.content) {
//                 return new Paragraph({ children: createTextRuns(node.content) });
//             }
//             return new Paragraph({ children: [new TextRun("")] });
//     }
// }

// async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
//     const tableCells: TableCell[] = [];
//     if (!Array.isArray(sections)) { return tableCells; }
    
//     for (const section of sections) {
//         const sectionChildren: (Paragraph | Table)[] = [];
//         sectionChildren.push(new Paragraph({ children: [new TextRun({ text: section.label, bold: true })], spacing: { after: 100 } }));

//         const tiptapJson = section.content as TiptapNode;
//         if (tiptapJson && Array.isArray(tiptapJson.content)) {
//             for (const node of tiptapJson.content) {
//                 const docxElement = await nodeToDocx(node);
//                 if (docxElement) {
//                     if (Array.isArray(docxElement)) {
//                         sectionChildren.push(...docxElement);
//                     } else {
//                         sectionChildren.push(docxElement);
//                     }
//                 }
//             }
//         } else {
//             sectionChildren.push(new Paragraph(""));
//         }

//         tableCells.push(new TableCell({
//             children: sectionChildren,
//             borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//             columnSpan: 2,
//             margins: cellMargins,
//         }));
//     }
//     return tableCells;
// }

// // --- PARSER LAMPIRAN ---
// async function parseAttachments(attachments: any[]): Promise<Table[]> {
//     const attachmentContent: Paragraph[] = [];
//     if (!Array.isArray(attachments) || attachments.length === 0) {
//         return [];
//     }
//     attachmentContent.push(new Paragraph({
//         children: [new TextRun({ text: "Lampiran", bold: true })],
//         alignment: AlignmentType.LEFT,
//         spacing: { before: 200, after: 100 }
//     }));
    
//     let index = 0;
//     for (const section of attachments) {
//         attachmentContent.push(new Paragraph({
//             children: [new TextRun({ text: `${index + 1}. ${section.section_name}`, bold: false })],
//             spacing: { after: 100 }
//         }));

//         if (Array.isArray(section.files)) {
//             for (const file of section.files) {
//                 if (file.url) {
//                     const imgBuffer = await fetchImage(file.url); 
//                     if (imgBuffer) {
//                         attachmentContent.push(new Paragraph({
//                             children: [new ImageRun({
//                                 data: imgBuffer.toString("base64"),
//                                 transformation: { width: 450, height: 300 }
//                             } as any)],
//                             alignment: AlignmentType.CENTER,
//                             spacing: { after: 100 }
//                         }));
//                     }
//                 }
//             }
//         }
//         index++;
//     }

//     const attachmentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: attachmentContent,
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     return [attachmentTable];
// }
// // --- AKHIR PARSER LAMPIRAN ---

// // --- [BARU] PARSER APPROVER ---
// function createApproverTable(
//   sortedCompanyNames: string[],
//   groupedApprovers: { [key: string]: string[] }
// ): (Paragraph | Table)[] {
//     if (sortedCompanyNames.length === 0) {
//         return [];
//     }

//     const headerCells: TableCell[] = [];
//     const nameCells: TableCell[] = [];
//     const signatureCells: TableCell[] = [];
    
//     let totalApprovers = 0;
    
//     for (const companyName of sortedCompanyNames) {
//         const approvers = groupedApprovers[companyName];
//         if (!approvers || approvers.length === 0) continue;
        
//         totalApprovers += approvers.length;

//         // 1. Header Row Cell (Nama Perusahaan)
//         headerCells.push(
//             new TableCell({
//                 children: [new Paragraph({
//                     children: [new TextRun({ text: companyName, bold: true })],
//                     alignment: AlignmentType.CENTER,
//                 })],
//                 columnSpan: approvers.length,
//                 borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                 verticalAlign: VerticalAlign.CENTER,
//                 margins: cellMargins,
//             })
//         );

//         // 2. Name Row Cells (Nama Approver)
//         for (const name of approvers) {
//             nameCells.push(
//                 new TableCell({
//                     children: [new Paragraph({
//                         children: [new TextRun({ text: name })],
//                         alignment: AlignmentType.CENTER,
//                     })],
//                     borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                     verticalAlign: VerticalAlign.CENTER,
//                     margins: cellMargins,
//                 })
//             );
//         }

//         // 3. Signature Row Cells (Tempat TTD)
//         for (let i = 0; i < approvers.length; i++) {
//             signatureCells.push(
//                 new TableCell({
//                     children: [new Paragraph({ text: "", spacing: { before: 800, after: 800 } })], // Spasi untuk TTD
//                     borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                     verticalAlign: VerticalAlign.CENTER,
//                 })
//             );
//         }
//     }

//     if (totalApprovers === 0) {
//       return [];
//     }

//     // Hitung lebar kolom
//     const columnWidths = Array(totalApprovers).fill(Math.floor(100 / totalApprovers));

//     const approverTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         columnWidths: columnWidths,
//         rows: [
//             new TableRow({ children: headerCells }),
//             new TableRow({ children: signatureCells }), // Baris kosong untuk TTD
//             new TableRow({ children: nameCells }),      // Baris untuk nama
//         ]
//     });
    
//     // Kembalikan Judul dan Tabel
//     return [
//         new Paragraph({
//             children: [new TextRun({ text: "Disetujui Oleh:", bold: true })],
//             alignment: AlignmentType.CENTER,
//             spacing: { before: 200, after: 200 }
//         }),
//         approverTable
//     ];
// }
// // --- [BARU] AKHIR PARSER APPROVER ---


// // --- API ROUTE UTAMA ---
// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) { return NextResponse.json({ error: "MOM ID is required" }, { status: 400 }); }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true, // <-- DITAMBAHKAN
//         attachments: { include: { files: true } },
//         next_actions: true,
//         approvers: true, // <-- DITAMBAHKAN
//       },
//     });

//     if (!momData) { return NextResponse.json({ error: "MOM not found" }, { status: 404 }); }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const parsedContentTableCells = await parseTiptapContent(momData.content as any[] || []);
//     const attachmentTables = await parseAttachments(momData.attachments as any[]);

//     // --- [BARU] Logika Grup Approver ---
//     const telkomsatCompanyName = "Telkomsat";
//     const groupedApprovers: { [key: string]: string[] } = {};

//     for (const approver of momData.approvers) {
//       const companyName = approver.type === 'Internal' 
//         ? telkomsatCompanyName 
//         : momData.company?.name || 'Eksternal'; // Ambil nama perusahaan eksternal dari relasi
      
//       if (!groupedApprovers[companyName]) {
//         groupedApprovers[companyName] = [];
//       }
//       groupedApprovers[companyName].push(approver.name);
//     }
    
//     // Urutkan agar Telkomsat selalu di kiri
//     const sortedCompanyNames = Object.keys(groupedApprovers).sort((a, b) => {
//       if (a === telkomsatCompanyName && b !== telkomsatCompanyName) return -1;
//       if (a !== telkomsatCompanyName && b === telkomsatCompanyName) return 1;
//       return a.localeCompare(b);
//     });

//     // Buat elemen tabel approver
//     const approverTableElements = createApproverTable(sortedCompanyNames, groupedApprovers);
//     // --- [BARU] Akhir Logika Grup Approver ---


//     const attendeesText = momData.count_attendees || '(Tidak ada data peserta)';

//     // --- HEADER DOCX ---
//     const headerTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: defaultLogoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: defaultLogoBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }), new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }), ], width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: companyLogoApiBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: companyLogoApiBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                 ],
//             }),
//             new TableRow({
//                 children: [
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }), new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }), new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }), ], borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                 ],
//             }),
//         ],
//     });
//     // --- AKHIR HEADER DOCX ---

//     // --- TABEL NEXT ACTION ---
//     const nextActionTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [1000, 4000, 2500, 2500],
//         rows: [
//             new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph("No")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Action")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Due Date")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("UIC")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }),
//             ...(momData.next_actions || []).map((action: { action: string, target: string, pic: string }, index: number) => new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph(String(index + 1))], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.action)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.target)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.pic)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }))
//         ],
//         borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder }
//     });
//     // --- AKHIR TABEL NEXT ACTION ---

//     // --- TABEL UTAMA ---
//     const mainContentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             // BARIS 1: Attendees
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Attendees", bold: true })]
//                         })],
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         verticalAlign: VerticalAlign.CENTER,
//                         width: { size: 15, type: WidthType.PERCENTAGE },
//                         margins: cellMargins,
//                     }),
//                     new TableCell({
//                         children: [new Paragraph(attendeesText)],
//                         borders: { top: thinBlackBorder, left: noBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         width: { size: 85, type: WidthType.PERCENTAGE },
//                         verticalAlign: VerticalAlign.CENTER,
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 2: Result Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Result", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 3: Description Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Description", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         shading: { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 4 dst: Section Konten Tiptap
//             ...parsedContentTableCells.map(cell => new TableRow({ children: [cell] })),
            
//             // BARIS TERAKHIR KONTEN: Next Action Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({ children: [new TextRun({ text: "Next Action", bold: true })] })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             }),
//              // BARIS SETELAH Next Action Title: Tabel Next Action
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [nextActionTable],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     // --- AKHIR TABEL UTAMA ---

//     const doc = new Document({
//       numbering: numberingConfig,
//       sections: [{
//         headers: { 
//             default: new Header({ 
//                 children: [
//                     headerTable,
//                     new Paragraph({ text: "" })
//                 ] 
//             }) 
//         },
//         footers: { default: new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], italics: true }), ], }), ], }) },
        
//         properties: {
//             page: {
//                 margin: {
//                     top: 1440, 
//                     right: 1440,
//                     bottom: 1440,
//                     left: 1440,
//                 }
//             }
//         },

//         children: [
//             mainContentTable,
//             new Paragraph({ text: "", spacing: { before: 200 } }),
//             ...approverTableElements, // <-- TABEL APPROVER DISISIPKAN DI SINI
//             ...attachmentTables
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
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle, Header, Footer, PageNumber, IBorderOptions, ShadingType,
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

// // --- Style Border ---
// const thinBlackBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
// const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

// // --- Cell Margins ---
// const cellMargins = { top: 100, bottom: 100, left: 100, right: 100 };

// // --- KONFIGURASI NUMBERING (LIST) ---
// const numberingConfig = {
//     config: [
//         {
//             reference: "my-bullet-points",
//             levels: [
//                 {
//                     level: 0,
//                     format: "bullet" as const,
//                     text: "\u2022",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//         {
//             reference: "my-ordered-list",
//             levels: [
//                 {
//                     level: 0,
//                     format: "decimal" as const,
//                     text: "%1.",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//     ],
// };

// // --- PARSER KONTEN TIPTAP ---
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; align?: 'left' | 'center' | 'right'; [key: string]: any };
// }

// async function nodeToDocx(node: TiptapNode, options: { isHeader?: boolean } = {}): Promise<(Paragraph | Table | Paragraph[]) | undefined> {
    
//     const createTextRuns = (content: TiptapNode[] | undefined): TextRun[] => {
//         const textRuns: TextRun[] = [];
//         if (content) {
//             for (const child of content) {
//                 if (child.type === 'text' && child.text) {
//                     textRuns.push(new TextRun({
//                         text: child.text || "",
//                         bold: options.isHeader || child.marks?.some(m => m.type === 'bold'),
//                         italics: child.marks?.some(m => m.type === 'italic'),
//                     }));
//                 }
//             }
//         }
//         return textRuns.length === 0 ? [new TextRun("")] : textRuns;
//     };

//     // --- Helper untuk konversi Tiptap align ke DOCX align ---
//     // --- vvv PERBAIKAN TIPE RETURN DI SINI vvv ---
//     const getAlignment = (
//       alignAttr?: 'left' | 'center' | 'right'
//     ): (typeof AlignmentType)[keyof typeof AlignmentType] => {
//         if (alignAttr === 'center') return AlignmentType.CENTER;
//         if (alignAttr === 'right') return AlignmentType.RIGHT;
//         return AlignmentType.LEFT;
//     };

//     switch (node.type) {
//         case 'paragraph':
//             return new Paragraph({ 
//                 children: createTextRuns(node.content),
//                 alignment: getAlignment(node.attrs?.align),
//             });

//         case 'bulletList':
//         case 'orderedList':
//             const listItems: Paragraph[] = [];
//             if (node.content) {
//                 for (const listItemNode of node.content) { 
//                     if (listItemNode.type === 'listItem' && listItemNode.content) {
//                         for (const itemContent of listItemNode.content) {
//                             if (itemContent.type === 'paragraph') {
//                                 listItems.push(new Paragraph({
//                                     children: createTextRuns(itemContent.content),
//                                     numbering: {
//                                         reference: node.type === 'bulletList' ? "my-bullet-points" : "my-ordered-list",
//                                         level: 0,
//                                     },
//                                     alignment: getAlignment(itemContent.attrs?.align),
//                                 }));
//                             }
//                         }
//                     }
//                 }
//             }
//             return listItems;

//         case 'image':
//             if (node.attrs?.src) {
//                 const imgBuffer = await fetchImage(node.attrs.src);
//                 if (imgBuffer) {
//                     return new Paragraph({
//                         children: [new ImageRun({ data: imgBuffer.toString("base64"), transformation: { width: 450, height: 300 } } as any)],
//                         alignment: getAlignment(node.attrs?.align),
//                     });
//                 }
//             }
//             return undefined;

//         case 'table':
//             const tableRows: TableRow[] = [];
//             if (node.content) { 
//                 for (const rowNode of node.content) { 
//                     if (rowNode.type === 'tableRow' && rowNode.content) { 
//                         const cells: TableCell[] = [];
//                         for (const cellNode of rowNode.content) {
//                             if (cellNode.type === 'tableCell' || cellNode.type === 'tableHeader') {
//                                 const isHeader = cellNode.type === 'tableHeader';
//                                 const cellParagraphs: Paragraph[] = [];
//                                 if (cellNode.content) {
//                                     for (const cellContentNode of cellNode.content) {
//                                         const docxElement = await nodeToDocx(cellContentNode, { isHeader: isHeader });
//                                         if (docxElement) {
//                                             if (Array.isArray(docxElement)) {
//                                                 cellParagraphs.push(...docxElement);
//                                             } else if (docxElement instanceof Paragraph) {
//                                                 cellParagraphs.push(docxElement);
//                                             }
//                                         }
//                                     }
//                                 }
//                                 cells.push(new TableCell({
//                                     children: cellParagraphs.length === 0 ? [new Paragraph("")] : cellParagraphs,
//                                     borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                                     verticalAlign: VerticalAlign.CENTER,
//                                     margins: cellMargins,
//                                     shading: isHeader ? { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" } : undefined,
//                                 }));
//                             }
//                         }
//                         tableRows.push(new TableRow({ children: cells }));
//                     }
//                 }
//             }
//             return new Table({
//                 width: { size: 100, type: WidthType.PERCENTAGE },
//                 rows: tableRows,
//                 alignment: getAlignment(node.attrs?.align),
//             });

//         default:
//             if (node.content) {
//                 return new Paragraph({ children: createTextRuns(node.content) });
//             }
//             return new Paragraph({ children: [new TextRun("")] });
//     }
// }

// async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
//     const tableCells: TableCell[] = [];
//     if (!Array.isArray(sections)) { return tableCells; }
    
//     for (const section of sections) {
//         const sectionChildren: (Paragraph | Table)[] = [];
//         sectionChildren.push(new Paragraph({ children: [new TextRun({ text: section.label, bold: true })], spacing: { after: 100 } }));

//         const tiptapJson = section.content as TiptapNode;
//         if (tiptapJson && Array.isArray(tiptapJson.content)) {
//             for (const node of tiptapJson.content) {
//                 const docxElement = await nodeToDocx(node);
//                 if (docxElement) {
//                     if (Array.isArray(docxElement)) {
//                         sectionChildren.push(...docxElement);
//                     } else {
//                         sectionChildren.push(docxElement);
//                     }
//                 }
//             }
//         } else {
//             sectionChildren.push(new Paragraph(""));
//         }

//         tableCells.push(new TableCell({
//             children: sectionChildren,
//             borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//             columnSpan: 2,
//             margins: cellMargins,
//         }));
//     }
//     return tableCells;
// }

// // --- PARSER LAMPIRAN ---
// async function parseAttachments(attachments: any[]): Promise<Table[]> {
//     const attachmentContent: Paragraph[] = [];
//     if (!Array.isArray(attachments) || attachments.length === 0) {
//         return [];
//     }
//     attachmentContent.push(new Paragraph({
//         children: [new TextRun({ text: "Lampiran", bold: true })],
//         alignment: AlignmentType.LEFT,
//         spacing: { before: 200, after: 100 }
//     }));
    
//     let index = 0;
//     for (const section of attachments) {
//         attachmentContent.push(new Paragraph({
//             children: [new TextRun({ text: `${index + 1}. ${section.section_name}`, bold: false })],
//             spacing: { after: 100 }
//         }));

//         if (Array.isArray(section.files)) {
//             for (const file of section.files) {
//                 if (file.url) {
//                     const imgBuffer = await fetchImage(file.url); 
//                     if (imgBuffer) {
//                         attachmentContent.push(new Paragraph({
//                             children: [new ImageRun({
//                                 data: imgBuffer.toString("base64"),
//                                 transformation: { width: 450, height: 300 }
//                             } as any)],
//                             alignment: AlignmentType.CENTER,
//                             spacing: { after: 100 }
//                         }));
//                     }
//                 }
//             }
//         }
//         index++;
//     }

//     const attachmentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: attachmentContent,
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     return [attachmentTable];
// }
// // --- AKHIR PARSER LAMPIRAN ---


// // --- API ROUTE UTAMA ---
// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) { return NextResponse.json({ error: "MOM ID is required" }, { status: 400 }); }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) { return NextResponse.json({ error: "MOM not found" }, { status: 404 }); }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const parsedContentTableCells = await parseTiptapContent(momData.content as any[] || []);
//     const attachmentTables = await parseAttachments(momData.attachments as any[]);

//     const attendeesText = momData.count_attendees || '(Tidak ada data peserta)';

//     // --- HEADER DOCX ---
//     const headerTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: defaultLogoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: defaultLogoBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }), new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }), ], width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: companyLogoApiBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: companyLogoApiBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                 ],
//             }),
//             new TableRow({
//                 children: [
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }), new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }), new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }), ], borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                 ],
//             }),
//         ],
//     });
//     // --- AKHIR HEADER DOCX ---

//     // --- TABEL NEXT ACTION ---
//     const nextActionTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [1000, 4000, 2500, 2500],
//         rows: [
//             new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph("No")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Action")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Due Date")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("UIC")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }),
//             ...(momData.next_actions || []).map((action: { action: string, target: string, pic: string }, index: number) => new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph(String(index + 1))], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.action)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.target)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.pic)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }))
//         ],
//         borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder }
//     });
//     // --- AKHIR TABEL NEXT ACTION ---

//     // --- TABEL UTAMA ---
//     const mainContentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             // BARIS 1: Attendees
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Attendees", bold: true })]
//                         })],
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         verticalAlign: VerticalAlign.CENTER,
//                         width: { size: 15, type: WidthType.PERCENTAGE },
//                         margins: cellMargins,
//                     }),
//                     new TableCell({
//                         children: [new Paragraph(attendeesText)],
//                         borders: { top: thinBlackBorder, left: noBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         width: { size: 85, type: WidthType.PERCENTAGE },
//                         verticalAlign: VerticalAlign.CENTER,
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 2: Result Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Result", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 3: Description Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Description", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         shading: { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 4 dst: Section Konten Tiptap
//             ...parsedContentTableCells.map(cell => new TableRow({ children: [cell] })),
            
//             // BARIS TERAKHIR KONTEN: Next Action Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({ children: [new TextRun({ text: "Next Action", bold: true })] })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             }),
//              // BARIS SETELAH Next Action Title: Tabel Next Action
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [nextActionTable],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     // --- AKHIR TABEL UTAMA ---

//     const doc = new Document({
//       numbering: numberingConfig,
//       sections: [{
//         headers: { 
//             default: new Header({ 
//                 children: [
//                     headerTable,
//                     new Paragraph({ text: "" })
//                 ] 
//             }) 
//         },
//         footers: { default: new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], italics: true }), ], }), ], }) },
        
//         properties: {
//             page: {
//                 margin: {
//                     top: 1440, 
//                     right: 1440,
//                     bottom: 1440,
//                     left: 1440,
//                 }
//             }
//         },

//         children: [
//             mainContentTable,
//             new Paragraph({ text: "", spacing: { before: 200 } }),
//             ...attachmentTables
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
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle, Header, Footer, PageNumber, IBorderOptions, ShadingType,
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

// // --- Style Border ---
// const thinBlackBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
// const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

// // --- Cell Margins ---
// const cellMargins = { top: 100, bottom: 100, left: 100, right: 100 };

// // --- KONFIGURASI NUMBERING (LIST) ---
// const numberingConfig = {
//     config: [
//         {
//             reference: "my-bullet-points",
//             levels: [
//                 {
//                     level: 0,
//                     format: "bullet" as const,
//                     text: "\u2022",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//         {
//             reference: "my-ordered-list",
//             levels: [
//                 {
//                     level: 0,
//                     format: "decimal" as const,
//                     text: "%1.",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//     ],
// };

// // --- PARSER KONTEN TIPTAP ---
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; [key: string]: any };
// }

// async function nodeToDocx(node: TiptapNode, options: { isHeader?: boolean } = {}): Promise<(Paragraph | Table | Paragraph[]) | undefined> {
    
//     const createTextRuns = (content: TiptapNode[] | undefined): TextRun[] => {
//         const textRuns: TextRun[] = [];
//         if (content) {
//             for (const child of content) {
//                 if (child.type === 'text' && child.text) {
//                     textRuns.push(new TextRun({
//                         text: child.text || "",
//                         bold: options.isHeader || child.marks?.some(m => m.type === 'bold'),
//                         italics: child.marks?.some(m => m.type === 'italic'),
//                     }));
//                 }
//             }
//         }
//         return textRuns.length === 0 ? [new TextRun("")] : textRuns;
//     };

//     switch (node.type) {
//         case 'paragraph':
//             return new Paragraph({ children: createTextRuns(node.content) });

//         case 'bulletList':
//         case 'orderedList':
//             const listItems: Paragraph[] = [];
//             if (node.content) {
//                 for (const listItemNode of node.content) {
//                     if (listItemNode.type === 'listItem' && listItemNode.content) {
//                         for (const itemContent of listItemNode.content) {
//                             if (itemContent.type === 'paragraph') {
//                                 listItems.push(new Paragraph({
//                                     children: createTextRuns(itemContent.content),
//                                     numbering: {
//                                         reference: node.type === 'bulletList' ? "my-bullet-points" : "my-ordered-list",
//                                         level: 0,
//                                     },
//                                 }));
//                             }
//                         }
//                     }
//                 }
//             }
//             return listItems;

//         case 'image':
//             if (node.attrs?.src) {
//                 const imgBuffer = await fetchImage(node.attrs.src);
//                 if (imgBuffer) {
//                     return new Paragraph({
//                         children: [new ImageRun({ data: imgBuffer.toString("base64"), transformation: { width: 450, height: 300 } } as any)],
//                         alignment: AlignmentType.CENTER
//                     });
//                 }
//             }
//             return undefined;

//         case 'table':
//             const tableRows: TableRow[] = [];
//             if (node.content) { 
//                 for (const rowNode of node.content) { 
//                     if (rowNode.type === 'tableRow' && rowNode.content) { 
//                         const cells: TableCell[] = [];
//                         for (const cellNode of rowNode.content) {
//                             if (cellNode.type === 'tableCell' || cellNode.type === 'tableHeader') {
//                                 const isHeader = cellNode.type === 'tableHeader';
//                                 const cellParagraphs: Paragraph[] = [];
//                                 if (cellNode.content) {
//                                     for (const cellContentNode of cellNode.content) {
//                                         const docxElement = await nodeToDocx(cellContentNode, { isHeader: isHeader });
//                                         if (docxElement) {
//                                             if (Array.isArray(docxElement)) {
//                                                 cellParagraphs.push(...docxElement);
//                                             } else if (docxElement instanceof Paragraph) {
//                                                 cellParagraphs.push(docxElement);
//                                             }
//                                         }
//                                     }
//                                 }
//                                 cells.push(new TableCell({
//                                     children: cellParagraphs.length === 0 ? [new Paragraph("")] : cellParagraphs,
//                                     borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                                     verticalAlign: VerticalAlign.CENTER,
//                                     margins: cellMargins,
//                                     shading: isHeader ? { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" } : undefined,
//                                 }));
//                             }
//                         }
//                         tableRows.push(new TableRow({ children: cells }));
//                     }
//                 }
//             }
//             return new Table({
//                 width: { size: 100, type: WidthType.PERCENTAGE },
//                 rows: tableRows,
//             });

//         default:
//             if (node.content) {
//                 return new Paragraph({ children: createTextRuns(node.content) });
//             }
//             return new Paragraph({ children: [new TextRun("")] });
//     }
// }

// async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
//     const tableCells: TableCell[] = [];
//     if (!Array.isArray(sections)) { return tableCells; }
    
//     for (const section of sections) {
//         const sectionChildren: (Paragraph | Table)[] = [];
//         sectionChildren.push(new Paragraph({ children: [new TextRun({ text: section.label, bold: true })], spacing: { after: 100 } }));

//         const tiptapJson = section.content as TiptapNode;
//         if (tiptapJson && Array.isArray(tiptapJson.content)) {
//             for (const node of tiptapJson.content) {
//                 const docxElement = await nodeToDocx(node);
//                 if (docxElement) {
//                     if (Array.isArray(docxElement)) {
//                         sectionChildren.push(...docxElement);
//                     } else {
//                         sectionChildren.push(docxElement);
//                     }
//                 }
//             }
//         } else {
//             sectionChildren.push(new Paragraph(""));
//         }

//         tableCells.push(new TableCell({
//             children: sectionChildren,
//             borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//             columnSpan: 2,
//             margins: cellMargins,
//         }));
//     }
//     return tableCells;
// }

// // --- PARSER LAMPIRAN ---
// async function parseAttachments(attachments: any[]): Promise<Table[]> {
//     const attachmentContent: Paragraph[] = [];
//     if (!Array.isArray(attachments) || attachments.length === 0) {
//         return [];
//     }
//     attachmentContent.push(new Paragraph({
//         children: [new TextRun({ text: "Lampiran", bold: true })],
//         alignment: AlignmentType.LEFT,
//         spacing: { before: 200, after: 100 }
//     }));
    
//     // --- vvv PERBAIKAN DI SINI: Menggunakan for...of agar 'await' berfungsi ---
//     let index = 0;
//     for (const section of attachments) {
//         attachmentContent.push(new Paragraph({
//             children: [new TextRun({ text: `${index + 1}. ${section.section_name}`, bold: false })],
//             spacing: { after: 100 }
//         }));

//         if (Array.isArray(section.files)) {
//             for (const file of section.files) {
//                 if (file.url) {
//                     // 'await' sekarang legal di dalam loop for...of
//                     const imgBuffer = await fetchImage(file.url); 
//                     if (imgBuffer) {
//                         attachmentContent.push(new Paragraph({
//                             children: [new ImageRun({
//                                 data: imgBuffer.toString("base64"),
//                                 transformation: { width: 450, height: 300 }
//                             } as any)],
//                             alignment: AlignmentType.CENTER,
//                             spacing: { after: 100 }
//                         }));
//                     }
//                 }
//             }
//         }
//         index++; // Increment index manual
//     }
//     // --- ^^^ AKHIR PERBAIKAN ^^^ ---

//     const attachmentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: attachmentContent,
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     return [attachmentTable];
// }
// // --- AKHIR PARSER LAMPIRAN ---


// // --- API ROUTE UTAMA ---
// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) { return NextResponse.json({ error: "MOM ID is required" }, { status: 400 }); }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) { return NextResponse.json({ error: "MOM not found" }, { status: 404 }); }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const parsedContentTableCells = await parseTiptapContent(momData.content as any[] || []);
//     const attachmentTables = await parseAttachments(momData.attachments as any[]);

//     const attendeesText = momData.count_attendees || '(Tidak ada data peserta)';

//     // --- HEADER DOCX ---
//     const headerTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: defaultLogoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: defaultLogoBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }), new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }), ], width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: companyLogoApiBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: companyLogoApiBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                 ],
//             }),
//             new TableRow({
//                 children: [
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }), new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }), new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }), ], borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                 ],
//             }),
//         ],
//     });
//     // --- AKHIR HEADER DOCX ---

//     // --- TABEL NEXT ACTION ---
//     const nextActionTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [1000, 4000, 2500, 2500],
//         rows: [
//             new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph("No")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Action")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Due Date")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("UIC")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }),
//             ...(momData.next_actions || []).map((action: { action: string, target: string, pic: string }, index: number) => new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph(String(index + 1))], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.action)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.target)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.pic)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }))
//         ],
//         borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder }
//     });
//     // --- AKHIR TABEL NEXT ACTION ---

//     // --- TABEL UTAMA ---
//     const mainContentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             // BARIS 1: Attendees
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Attendees", bold: true })]
//                         })],
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         verticalAlign: VerticalAlign.CENTER,
//                         width: { size: 15, type: WidthType.PERCENTAGE },
//                         margins: cellMargins,
//                     }),
//                     new TableCell({
//                         children: [new Paragraph(attendeesText)],
//                         borders: { top: thinBlackBorder, left: noBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         width: { size: 85, type: WidthType.PERCENTAGE },
//                         verticalAlign: VerticalAlign.CENTER,
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 2: Result Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Result", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 3: Description Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Description", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         shading: { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 4 dst: Section Konten Tiptap
//             ...parsedContentTableCells.map(cell => new TableRow({ children: [cell] })),
            
//             // BARIS TERAKHIR KONTEN: Next Action Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({ children: [new TextRun({ text: "Next Action", bold: true })] })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             }),
//              // BARIS SETELAH Next Action Title: Tabel Next Action
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [nextActionTable],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     // --- AKHIR TABEL UTAMA ---

//     const doc = new Document({
//       numbering: numberingConfig,
//       sections: [{
//         headers: { 
//             default: new Header({ 
//                 children: [
//                     headerTable,
//                     new Paragraph({ text: "" })
//                 ] 
//             }) 
//         },
//         footers: { default: new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], italics: true }), ], }), ], }) },
        
//         properties: {
//             page: {
//                 margin: {
//                     top: 1440, 
//                     right: 1440,
//                     bottom: 1440,
//                     left: 1440,
//                 }
//             }
//         },

//         children: [
//             mainContentTable,
//             new Paragraph({ text: "", spacing: { before: 200 } }),
//             ...attachmentTables
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
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle, Header, Footer, PageNumber, IBorderOptions, ShadingType,
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

// // --- Style Border ---
// const thinBlackBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
// const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

// // --- Cell Margins ---
// const cellMargins = { top: 100, bottom: 100, left: 100, right: 100 };

// // --- KONFIGURASI NUMBERING (LIST) ---
// const numberingConfig = {
//     config: [
//         {
//             reference: "my-bullet-points",
//             levels: [
//                 {
//                     level: 0,
//                     format: "bullet" as const, // Tipe Teks "bullet"
//                     text: "\u2022",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//         {
//             reference: "my-ordered-list",
//             levels: [
//                 {
//                     level: 0,
//                     format: "decimal" as const, // Tipe Teks "decimal"
//                     text: "%1.",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//     ],
// };

// // --- PARSER KONTEN TIPTAP ---
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; [key: string]: any };
// }

// async function nodeToDocx(node: TiptapNode, options: { isHeader?: boolean } = {}): Promise<(Paragraph | Table | Paragraph[]) | undefined> {
    
//     // Fungsi untuk membuat TextRun dari node Tiptap
//     const createTextRuns = (content: TiptapNode[] | undefined): TextRun[] => {
//         const textRuns: TextRun[] = [];
//         if (content) {
//             for (const child of content) {
//                 if (child.type === 'text' && child.text) {
//                     textRuns.push(new TextRun({
//                         text: child.text || "",
//                         bold: options.isHeader || child.marks?.some(m => m.type === 'bold'),
//                         italics: child.marks?.some(m => m.type === 'italic'),
//                     }));
//                 }
//             }
//         }
//         return textRuns.length === 0 ? [new TextRun("")] : textRuns;
//     };

//     switch (node.type) {
//         case 'paragraph':
//             return new Paragraph({ children: createTextRuns(node.content) });

//         case 'bulletList':
//         case 'orderedList':
//             const listItems: Paragraph[] = [];
//             if (node.content) {
//                 for (const listItemNode of node.content) { // <li>
//                     if (listItemNode.type === 'listItem' && listItemNode.content) {
//                         // Konten <li> biasanya <p>
//                         for (const itemContent of listItemNode.content) {
//                             if (itemContent.type === 'paragraph') {
//                                 listItems.push(new Paragraph({
//                                     children: createTextRuns(itemContent.content),
//                                     numbering: {
//                                         reference: node.type === 'bulletList' ? "my-bullet-points" : "my-ordered-list",
//                                         level: 0,
//                                     },
//                                 }));
//                             }
//                         }
//                     }
//                 }
//             }
//             return listItems; // Kembalikan sebagai array Paragraf

//         case 'image':
//             if (node.attrs?.src) {
//                 const imgBuffer = await fetchImage(node.attrs.src);
//                 if (imgBuffer) {
//                     return new Paragraph({
//                         children: [new ImageRun({ data: imgBuffer.toString("base64"), transformation: { width: 450, height: 300 } } as any)],
//                         alignment: AlignmentType.CENTER
//                     });
//                 }
//             }
//             return undefined;

//         case 'table':
//             const tableRows: TableRow[] = [];
//             if (node.content) { 
//                 for (const rowNode of node.content) { 
//                     if (rowNode.type === 'tableRow' && rowNode.content) { 
//                         const cells: TableCell[] = [];
//                         for (const cellNode of rowNode.content) {
//                             if (cellNode.type === 'tableCell' || cellNode.type === 'tableHeader') {
//                                 const isHeader = cellNode.type === 'tableHeader';
//                                 const cellParagraphs: Paragraph[] = [];
//                                 if (cellNode.content) {
//                                     for (const cellContentNode of cellNode.content) {
//                                         const docxElement = await nodeToDocx(cellContentNode, { isHeader: isHeader });
//                                         if (docxElement) {
//                                             if (Array.isArray(docxElement)) {
//                                                 cellParagraphs.push(...docxElement);
//                                             } else if (docxElement instanceof Paragraph) {
//                                                 cellParagraphs.push(docxElement);
//                                             }
//                                         }
//                                     }
//                                 }
//                                 cells.push(new TableCell({
//                                     children: cellParagraphs.length === 0 ? [new Paragraph("")] : cellParagraphs,
//                                     borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                                     verticalAlign: VerticalAlign.CENTER,
//                                     margins: cellMargins,
//                                     shading: isHeader ? { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" } : undefined,
//                                 }));
//                             }
//                         }
//                         tableRows.push(new TableRow({ children: cells }));
//                     }
//                 }
//             }
//             return new Table({
//                 width: { size: 100, type: WidthType.PERCENTAGE },
//                 rows: tableRows,
//             });

//         default:
//             // Fallback untuk node yang tidak dikenal, render teksnya jika ada
//             if (node.content) {
//                 return new Paragraph({ children: createTextRuns(node.content) });
//             }
//             return new Paragraph({ children: [new TextRun("")] });
//     }
// }

// async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
//     const tableCells: TableCell[] = [];
//     if (!Array.isArray(sections)) { return tableCells; }
    
//     for (const section of sections) {
//         const sectionChildren: (Paragraph | Table)[] = [];
//         sectionChildren.push(new Paragraph({ children: [new TextRun({ text: section.label, bold: true })], spacing: { after: 100 } }));

//         const tiptapJson = section.content as TiptapNode;
//         if (tiptapJson && Array.isArray(tiptapJson.content)) {
//             for (const node of tiptapJson.content) {
//                 const docxElement = await nodeToDocx(node);
//                 if (docxElement) {
//                     if (Array.isArray(docxElement)) {
//                         sectionChildren.push(...docxElement);
//                     } else {
//                         sectionChildren.push(docxElement);
//                     }
//                 }
//             }
//         } else {
//             sectionChildren.push(new Paragraph(""));
//         }

//         tableCells.push(new TableCell({
//             children: sectionChildren,
//             borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//             columnSpan: 2,
//             margins: cellMargins,
//         }));
//     }
//     return tableCells;
// }

// // --- PARSER LAMPIRAN ---
// async function parseAttachments(attachments: any[]): Promise<Table[]> {
//     const attachmentContent: Paragraph[] = [];
//     if (!Array.isArray(attachments) || attachments.length === 0) {
//         return [];
//     }
//     attachmentContent.push(new Paragraph({
//         children: [new TextRun({ text: "Lampiran", bold: true })],
//         alignment: AlignmentType.LEFT,
//         spacing: { before: 200, after: 100 }
//     }));
    
//     await Promise.all(attachments.map(async (section, index) => {
//         attachmentContent.push(new Paragraph({
//             children: [new TextRun({ text: `${index + 1}. ${section.section_name}`, bold: false })],
//             spacing: { after: 100 }
//         }));

//         if (Array.isArray(section.files)) {
//             for (const file of section.files) {
//                 if (file.url) {
//                     const imgBuffer = await fetchImage(file.url);
//                     if (imgBuffer) {
//                         attachmentContent.push(new Paragraph({
//                             children: [new ImageRun({
//                                 data: imgBuffer.toString("base64"),
//                                 transformation: { width: 450, height: 300 }
//                             } as any)],
//                             alignment: AlignmentType.CENTER,
//                             spacing: { after: 100 }
//                         }));
//                     }
//                 }
//             }
//         }
//     }));

//     const attachmentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: attachmentContent,
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     return [attachmentTable];
// }
// // --- AKHIR PARSER LAMPIRAN ---


// // --- API ROUTE UTAMA ---
// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) { return NextResponse.json({ error: "MOM ID is required" }, { status: 400 }); }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) { return NextResponse.json({ error: "MOM not found" }, { status: 404 }); }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const parsedContentTableCells = await parseTiptapContent(momData.content as any[] || []);
//     const attachmentTables = await parseAttachments(momData.attachments as any[]);

//     const attendeesText = momData.count_attendees || '(Tidak ada data peserta)';

//     // --- HEADER DOCX ---
//     const headerTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: defaultLogoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: defaultLogoBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }), new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }), ], width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: companyLogoApiBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: companyLogoApiBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                 ],
//             }),
//             new TableRow({
//                 children: [
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }), new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }), new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }), ], borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                 ],
//             }),
//         ],
//     });
//     // --- AKHIR HEADER DOCX ---

//     // --- TABEL NEXT ACTION ---
//     const nextActionTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [1000, 4000, 2500, 2500],
//         rows: [
//             new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph("No")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Action")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Due Date")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("UIC")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }),
//             ...(momData.next_actions || []).map((action: { action: string, target: string, pic: string }, index: number) => new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph(String(index + 1))], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.action)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.target)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.pic)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }))
//         ],
//         borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder }
//     });
//     // --- AKHIR TABEL NEXT ACTION ---

//     // --- TABEL UTAMA ---
//     const mainContentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             // BARIS 1: Attendees
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Attendees", bold: true })]
//                         })],
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         verticalAlign: VerticalAlign.CENTER,
//                         width: { size: 15, type: WidthType.PERCENTAGE },
//                         margins: cellMargins,
//                     }),
//                     new TableCell({
//                         children: [new Paragraph(attendeesText)],
//                         borders: { top: thinBlackBorder, left: noBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         width: { size: 85, type: WidthType.PERCENTAGE },
//                         verticalAlign: VerticalAlign.CENTER,
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 2: Result Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Result", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 3: Description Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Description", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         shading: { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 4 dst: Section Konten Tiptap
//             ...parsedContentTableCells.map(cell => new TableRow({ children: [cell] })),
            
//             // BARIS TERAKHIR KONTEN: Next Action Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({ children: [new TextRun({ text: "Next Action", bold: true })] })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             }),
//              // BARIS SETELAH Next Action Title: Tabel Next Action
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [nextActionTable],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     // --- AKHIR TABEL UTAMA ---

//     const doc = new Document({
//       numbering: numberingConfig,
//       sections: [{
//         headers: { 
//             default: new Header({ 
//                 children: [
//                     headerTable,
//                     new Paragraph({ text: "" })
//                 ] 
//             }) 
//         },
//         footers: { default: new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], italics: true }), ], }), ], }) },
        
//         properties: {
//             page: {
//                 margin: {
//                     top: 1440, 
//                     right: 1440,
//                     bottom: 1440,
//                     left: 1440,
//                 }
//             }
//         },

//         children: [
//             mainContentTable,
//             new Paragraph({ text: "", spacing: { before: 200 } }),
//             ...attachmentTables
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
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle, Header, Footer, PageNumber, IBorderOptions, ShadingType,
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

// // --- Style Border ---
// const thinBlackBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
// const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

// // --- Cell Margins ---
// const cellMargins = { top: 100, bottom: 100, left: 100, right: 100 };

// // --- KONFIGURASI NUMBERING (LIST) ---
// const numberingConfig = {
//     config: [
//         {
//             reference: "my-bullet-points",
//             levels: [
//                 {
//                     level: 0,
//                     format: "bullet" as const, // Tipe Teks "bullet"
//                     text: "\u2022",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//         {
//             reference: "my-ordered-list",
//             levels: [
//                 {
//                     level: 0,
//                     format: "decimal" as const, // Tipe Teks "decimal"
//                     text: "%1.",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//     ],
// };

// // --- PARSER KONTEN TIPTAP ---
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; [key: string]: any };
// }

// async function nodeToDocx(node: TiptapNode, options: { isHeader?: boolean } = {}): Promise<(Paragraph | Table | Paragraph[]) | undefined> {
    
//     // Fungsi untuk membuat TextRun dari node Tiptap
//     const createTextRuns = (content: TiptapNode[] | undefined): TextRun[] => {
//         const textRuns: TextRun[] = [];
//         if (content) {
//             for (const child of content) {
//                 if (child.type === 'text' && child.text) {
//                     textRuns.push(new TextRun({
//                         text: child.text || "",
//                         bold: options.isHeader || child.marks?.some(m => m.type === 'bold'),
//                         italics: child.marks?.some(m => m.type === 'italic'),
//                     }));
//                 }
//             }
//         }
//         return textRuns.length === 0 ? [new TextRun("")] : textRuns;
//     };

//     switch (node.type) {
//         case 'paragraph':
//             return new Paragraph({ children: createTextRuns(node.content) });

//         case 'bulletList':
//         case 'orderedList':
//             const listItems: Paragraph[] = [];
//             if (node.content) {
//                 for (const listItemNode of node.content) { // <li>
//                     if (listItemNode.type === 'listItem' && listItemNode.content) {
//                         // Konten <li> biasanya <p>
//                         for (const itemContent of listItemNode.content) {
//                             if (itemContent.type === 'paragraph') {
//                                 listItems.push(new Paragraph({
//                                     children: createTextRuns(itemContent.content),
//                                     numbering: {
//                                         reference: node.type === 'bulletList' ? "my-bullet-points" : "my-ordered-list",
//                                         level: 0,
//                                     },
//                                 }));
//                             }
//                             // (Catatan: Ini belum menangani list bersarang/nested list)
//                         }
//                     }
//                 }
//             }
//             return listItems; // Kembalikan sebagai array Paragraf

//         case 'image':
//             if (node.attrs?.src) {
//                 const imgBuffer = await fetchImage(node.attrs.src);
//                 if (imgBuffer) {
//                     return new Paragraph({
//                         children: [new ImageRun({ data: imgBuffer.toString("base64"), transformation: { width: 450, height: 300 } } as any)],
//                         alignment: AlignmentType.CENTER
//                     });
//                 }
//             }
//             return undefined;

//         case 'table':
//             const tableRows: TableRow[] = [];
//             if (node.content) { 
//                 for (const rowNode of node.content) { 
//                     if (rowNode.type === 'tableRow' && rowNode.content) { 
//                         const cells: TableCell[] = [];
//                         for (const cellNode of rowNode.content) {
//                             if (cellNode.type === 'tableCell' || cellNode.type === 'tableHeader') {
//                                 const isHeader = cellNode.type === 'tableHeader';
//                                 const cellParagraphs: Paragraph[] = [];
//                                 if (cellNode.content) {
//                                     for (const cellContentNode of cellNode.content) {
//                                         const docxElement = await nodeToDocx(cellContentNode, { isHeader: isHeader });
//                                         if (docxElement) {
//                                             if (Array.isArray(docxElement)) {
//                                                 cellParagraphs.push(...docxElement);
//                                             } else if (docxElement instanceof Paragraph) {
//                                                 cellParagraphs.push(docxElement);
//                                             }
//                                         }
//                                     }
//                                 }
//                                 cells.push(new TableCell({
//                                     children: cellParagraphs.length === 0 ? [new Paragraph("")] : cellParagraphs,
//                                     borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                                     verticalAlign: VerticalAlign.CENTER,
//                                     margins: cellMargins,
//                                     shading: isHeader ? { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" } : undefined,
//                                 }));
//                             }
//                         }
//                         tableRows.push(new TableRow({ children: cells }));
//                     }
//                 }
//             }
//             return new Table({
//                 width: { size: 100, type: WidthType.PERCENTAGE },
//                 rows: tableRows,
//             });

//         default:
//             return new Paragraph({ children: createTextRuns(node.content) });
//     }
// }

// async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
//     const tableCells: TableCell[] = [];
//     if (!Array.isArray(sections)) { return tableCells; }
    
//     for (const section of sections) {
//         const sectionChildren: (Paragraph | Table)[] = [];
//         sectionChildren.push(new Paragraph({ children: [new TextRun({ text: section.label, bold: true })], spacing: { after: 100 } }));

//         const tiptapJson = section.content as TiptapNode;
//         if (tiptapJson && Array.isArray(tiptapJson.content)) {
//             for (const node of tiptapJson.content) {
//                 const docxElement = await nodeToDocx(node);
//                 if (docxElement) {
//                     if (Array.isArray(docxElement)) {
//                         sectionChildren.push(...docxElement);
//                     } else {
//                         sectionChildren.push(docxElement);
//                     }
//                 }
//             }
//         } else {
//             sectionChildren.push(new Paragraph(""));
//         }

//         tableCells.push(new TableCell({
//             children: sectionChildren,
//             borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//             columnSpan: 2,
//             margins: cellMargins,
//         }));
//     }
//     return tableCells;
// }

// // --- PARSER LAMPIRAN ---
// async function parseAttachments(attachments: any[]): Promise<Table[]> {
//     const attachmentContent: Paragraph[] = [];
//     if (!Array.isArray(attachments) || attachments.length === 0) {
//         return [];
//     }
//     attachmentContent.push(new Paragraph({
//         children: [new TextRun({ text: "Lampiran", bold: true })],
//         alignment: AlignmentType.LEFT,
//         spacing: { before: 200, after: 100 }
//     }));
    
//     attachments.forEach(async (section, index) => {
//         attachmentContent.push(new Paragraph({
//             children: [new TextRun({ text: `${index + 1}. ${section.section_name}`, bold: false })],
//             spacing: { after: 100 }
//         }));

//         if (Array.isArray(section.files)) {
//             for (const file of section.files) {
//                 if (file.url) {
//                     const imgBuffer = await fetchImage(file.url);
//                     if (imgBuffer) {
//                         attachmentContent.push(new Paragraph({
//                             children: [new ImageRun({
//                                 data: imgBuffer.toString("base64"),
//                                 transformation: { width: 450, height: 300 }
//                             } as any)],
//                             alignment: AlignmentType.CENTER,
//                             spacing: { after: 100 }
//                         }));
//                     }
//                 }
//             }
//         }
//     });

//     const attachmentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: attachmentContent,
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     return [attachmentTable];
// }
// // --- AKHIR PARSER LAMPIRAN ---


// // --- API ROUTE UTAMA ---
// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) { return NextResponse.json({ error: "MOM ID is required" }, { status: 400 }); }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) { return NextResponse.json({ error: "MOM not found" }, { status: 404 }); }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const parsedContentTableCells = await parseTiptapContent(momData.content as any[] || []);
//     const attachmentTables = await parseAttachments(momData.attachments as any[]);

//     const attendeesText = momData.count_attendees || '(Tidak ada data peserta)';

//     // --- HEADER DOCX ---
//     const headerTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: defaultLogoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: defaultLogoBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }), new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }), ], width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: companyLogoApiBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: companyLogoApiBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                 ],
//             }),
//             new TableRow({
//                 children: [
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }), new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }), new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }), ], borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                 ],
//             }),
//         ],
//     });
//     // --- AKHIR HEADER DOCX ---

//     // --- TABEL NEXT ACTION ---
//     const nextActionTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [1000, 4000, 2500, 2500],
//         rows: [
//             new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph("No")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Action")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Due Date")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("UIC")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }),
//             ...(momData.next_actions || []).map((action: { action: string, target: string, pic: string }, index: number) => new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph(String(index + 1))], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.action)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.target)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.pic)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }))
//         ],
//         borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder }
//     });
//     // --- AKHIR TABEL NEXT ACTION ---

//     // --- TABEL UTAMA ---
//     const mainContentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             // BARIS 1: Attendees
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Attendees", bold: true })]
//                         })],
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         verticalAlign: VerticalAlign.CENTER,
//                         width: { size: 15, type: WidthType.PERCENTAGE },
//                         margins: cellMargins,
//                     }),
//                     new TableCell({
//                         children: [new Paragraph(attendeesText)],
//                         borders: { top: thinBlackBorder, left: noBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         width: { size: 85, type: WidthType.PERCENTAGE },
//                         verticalAlign: VerticalAlign.CENTER,
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 2: Result Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Result", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 3: Description Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Description", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         shading: { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 4 dst: Section Konten Tiptap
//             ...parsedContentTableCells.map(cell => new TableRow({ children: [cell] })),
            
//             // BARIS TERAKHIR KONTEN: Next Action Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({ children: [new TextRun({ text: "Next Action", bold: true })] })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             }),
//              // BARIS SETELAH Next Action Title: Tabel Next Action
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [nextActionTable],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     // --- AKHIR TABEL UTAMA ---

//     const doc = new Document({
//       numbering: numberingConfig,
//       sections: [{
//         headers: { 
//             default: new Header({ 
//                 children: [
//                     headerTable,
//                     new Paragraph({ text: "" })
//                 ] 
//             }) 
//         },
//         footers: { default: new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], italics: true }), ], }), ], }) },
        
//         properties: {
//             page: {
//                 margin: {
//                     top: 1440, 
//                     right: 1440,
//                     bottom: 1440,
//                     left: 1440,
//                 }
//             }
//         },

//         children: [
//             mainContentTable,
//             new Paragraph({ text: "", spacing: { before: 200 } }),
//             ...attachmentTables
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
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle, Header, Footer, PageNumber, IBorderOptions, ShadingType,
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
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; [key: string]: any };
// }

// async function nodeToDocx(node: TiptapNode, options: { isHeader?: boolean } = {}): Promise<(Paragraph | Table | Paragraph[]) | undefined> {
    
//     const createTextRuns = (content: TiptapNode[] | undefined): TextRun[] => {
//         const textRuns: TextRun[] = [];
//         if (content) {
//             for (const child of content) {
//                 if (child.type === 'text' && child.text) {
//                     textRuns.push(new TextRun({
//                         text: child.text || "",
//                         bold: options.isHeader || child.marks?.some(m => m.type === 'bold'),
//                         italics: child.marks?.some(m => m.type === 'italic'),
//                     }));
//                 }
//             }
//         }
//         return textRuns.length === 0 ? [new TextRun("")] : textRuns;
//     };

//     switch (node.type) {
//         case 'paragraph':
//             return new Paragraph({ children: createTextRuns(node.content) });

//         case 'bulletList':
//         case 'orderedList':
//             const listItems: Paragraph[] = [];
//             if (node.content) {
//                 for (const listItemNode of node.content) { 
//                     if (listItemNode.type === 'listItem' && listItemNode.content) {
//                         for (const itemContent of listItemNode.content) {
//                             if (itemContent.type === 'paragraph') {
//                                 listItems.push(new Paragraph({
//                                     children: createTextRuns(itemContent.content),
//                                     numbering: {
//                                         reference: node.type === 'bulletList' ? "my-bullet-points" : "my-ordered-list",
//                                         level: 0,
//                                     },
//                                 }));
//                             }
//                         }
//                     }
//                 }
//             }
//             return listItems;

//         case 'image':
//             if (node.attrs?.src) {
//                 const imgBuffer = await fetchImage(node.attrs.src);
//                 if (imgBuffer) {
//                     return new Paragraph({
//                         children: [new ImageRun({ data: imgBuffer.toString("base64"), transformation: { width: 450, height: 300 } } as any)],
//                         alignment: AlignmentType.CENTER
//                     });
//                 }
//             }
//             return undefined;

//         case 'table':
//             const tableRows: TableRow[] = [];
//             if (node.content) { 
//                 for (const rowNode of node.content) { 
//                     if (rowNode.type === 'tableRow' && rowNode.content) { 
//                         const cells: TableCell[] = [];
//                         for (const cellNode of rowNode.content) {
//                             if (cellNode.type === 'tableCell' || cellNode.type === 'tableHeader') {
//                                 const isHeader = cellNode.type === 'tableHeader';
//                                 const cellParagraphs: Paragraph[] = [];
//                                 if (cellNode.content) {
//                                     for (const cellContentNode of cellNode.content) {
//                                         const docxElement = await nodeToDocx(cellContentNode, { isHeader: isHeader });
//                                         if (docxElement) {
//                                             if (Array.isArray(docxElement)) {
//                                                 cellParagraphs.push(...docxElement);
//                                             } else if (docxElement instanceof Paragraph) {
//                                                 cellParagraphs.push(docxElement);
//                                             }
//                                         }
//                                     }
//                                 }
//                                 cells.push(new TableCell({
//                                     children: cellParagraphs.length === 0 ? [new Paragraph("")] : cellParagraphs,
//                                     borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                                     verticalAlign: VerticalAlign.CENTER,
//                                     margins: cellMargins,
//                                     shading: isHeader ? { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" } : undefined,
//                                 }));
//                             }
//                         }
//                         tableRows.push(new TableRow({ children: cells }));
//                     }
//                 }
//             }
//             return new Table({
//                 width: { size: 100, type: WidthType.PERCENTAGE },
//                 rows: tableRows,
//             });

//         default:
//             return new Paragraph({ children: createTextRuns(node.content) });
//     }
// }

// // --- Style Border ---
// const thinBlackBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
// const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

// // --- Cell Margins ---
// const cellMargins = { top: 100, bottom: 100, left: 100, right: 100 };

// // --- KONFIGURASI NUMBERING (LIST) ---
// const numberingConfig = {
//     config: [
//         {
//             reference: "my-bullet-points",
//             levels: [
//                 {
//                     level: 0,
//                     format: "bullet" as const, 
//                     text: "\u2022",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//         {
//             reference: "my-ordered-list",
//             levels: [
//                 {
//                     level: 0,
//                     format: "decimal" as const, 
//                     text: "%1.",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//     ],
// };

// async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
//     const tableCells: TableCell[] = [];
//     if (!Array.isArray(sections)) { return tableCells; }
    
//     for (const section of sections) {
//         const sectionChildren: (Paragraph | Table)[] = [];
//         sectionChildren.push(new Paragraph({ children: [new TextRun({ text: section.label, bold: true })], spacing: { after: 100 } }));

//         const tiptapJson = section.content as TiptapNode;
//         if (tiptapJson && Array.isArray(tiptapJson.content)) {
//             for (const node of tiptapJson.content) {
//                 const docxElement = await nodeToDocx(node);
//                 if (docxElement) {
//                     if (Array.isArray(docxElement)) {
//                         sectionChildren.push(...docxElement);
//                     } else {
//                         sectionChildren.push(docxElement);
//                     }
//                 }
//             }
//         } else {
//             sectionChildren.push(new Paragraph(""));
//         }

//         tableCells.push(new TableCell({
//             children: sectionChildren,
//             borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//             columnSpan: 2,
//             margins: cellMargins,
//         }));
//     }
//     return tableCells;
// }

// // --- PARSER LAMPIRAN ---
// async function parseAttachments(attachments: any[]): Promise<Table[]> {
//     const attachmentContent: Paragraph[] = [];
//     if (!Array.isArray(attachments) || attachments.length === 0) {
//         return [];
//     }
//     attachmentContent.push(new Paragraph({
//         children: [new TextRun({ text: "Lampiran", bold: true })],
//         alignment: AlignmentType.LEFT,
//         spacing: { before: 200, after: 100 }
//     }));
    
//     // --- vvv PERBAIKAN DI SINI vvv ---
//     // Gunakan .forEach atau .map untuk mendapatkan index
//     attachments.forEach((section, index) => {
//         attachmentContent.push(new Paragraph({
//             // Gunakan (index + 1) untuk penomoran dinamis
//             children: [new TextRun({ text: `${index + 1}. ${section.section_name}`, bold: false })],
//             spacing: { after: 100 }
//         }));
//     // --- ^^^ AKHIR PERBAIKAN ^^^ ---

//         if (Array.isArray(section.files)) {
//             for (const file of section.files) {
//                 if (file.url) {
//                     const imgBuffer = await fetchImage(file.url);
//                     if (imgBuffer) {
//                         attachmentContent.push(new Paragraph({
//                             children: [new ImageRun({
//                                 data: imgBuffer.toString("base64"),
//                                 transformation: { width: 450, height: 300 }
//                             } as any)],
//                             alignment: AlignmentType.CENTER,
//                             spacing: { after: 100 }
//                         }));
//                     }
//                 }
//             }
//         }
//     });

//     const attachmentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: attachmentContent,
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     return [attachmentTable];
// }
// // --- AKHIR PARSER LAMPIRAN ---


// // --- API ROUTE UTAMA ---
// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) { return NextResponse.json({ error: "MOM ID is required" }, { status: 400 }); }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) { return NextResponse.json({ error: "MOM not found" }, { status: 404 }); }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const parsedContentTableCells = await parseTiptapContent(momData.content as any[] || []);
//     const attachmentTables = await parseAttachments(momData.attachments as any[]);

//     const attendeesText = momData.count_attendees || '(Tidak ada data peserta)';

//     // --- HEADER DOCX ---
//     const headerTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: defaultLogoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: defaultLogoBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }), new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }), ], width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: companyLogoApiBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: companyLogoApiBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                 ],
//             }),
//             new TableRow({
//                 children: [
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }), new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }), new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }), ], borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                 ],
//             }),
//         ],
//     });
//     // --- AKHIR HEADER DOCX ---

//     // --- TABEL NEXT ACTION ---
//     const nextActionTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [1000, 4000, 2500, 2500],
//         rows: [
//             new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph("No")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Action")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Due Date")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("UIC")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }),
//             ...(momData.next_actions || []).map((action: { action: string, target: string, pic: string }, index: number) => new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph(String(index + 1))], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.action)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.target)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.pic)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }))
//         ],
//         borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder }
//     });
//     // --- AKHIR TABEL NEXT ACTION ---

//     // --- TABEL UTAMA ---
//     const mainContentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             // BARIS 1: Attendees
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Attendees", bold: true })]
//                         })],
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         verticalAlign: VerticalAlign.CENTER,
//                         width: { size: 15, type: WidthType.PERCENTAGE },
//                         margins: cellMargins,
//                     }),
//                     new TableCell({
//                         children: [new Paragraph(attendeesText)],
//                         borders: { top: thinBlackBorder, left: noBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         width: { size: 85, type: WidthType.PERCENTAGE },
//                         verticalAlign: VerticalAlign.CENTER,
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 2: Result Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Result", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 3: Description Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Description", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         shading: { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 4 dst: Section Konten Tiptap
//             ...parsedContentTableCells.map(cell => new TableRow({ children: [cell] })),
            
//             // BARIS TERAKHIR KONTEN: Next Action Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({ children: [new TextRun({ text: "Next Action", bold: true })] })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             }),
//              // BARIS SETELAH Next Action Title: Tabel Next Action
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [nextActionTable],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     // --- AKHIR TABEL UTAMA ---

//     const doc = new Document({
//       numbering: numberingConfig,
//       sections: [{
//         headers: { 
//             default: new Header({ 
//                 children: [
//                     headerTable,
//                     new Paragraph({ text: "" })
//                 ] 
//             }) 
//         },
//         footers: { default: new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], italics: true }), ], }), ], }) },
        
//         properties: {
//             page: {
//                 margin: {
//                     top: 1440, 
//                     right: 1440,
//                     bottom: 1440,
//                     left: 1440,
//                 }
//             }
//         },

//         children: [
//             mainContentTable,
//             new Paragraph({ text: "", spacing: { before: 200 } }),
//             ...attachmentTables
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
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle, Header, Footer, PageNumber, IBorderOptions, ShadingType,
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

// // --- Style Border ---
// const thinBlackBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
// const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

// // --- Cell Margins ---
// const cellMargins = { top: 100, bottom: 100, left: 100, right: 100 };

// // --- KONFIGURASI NUMBERING (LIST) ---
// const numberingConfig = {
//     config: [
//         {
//             reference: "my-bullet-points",
//             levels: [
//                 {
//                     level: 0,
//                     format: "bullet" as const, // <-- PERBAIKAN DI SINI
//                     text: "\u2022",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//         {
//             reference: "my-ordered-list",
//             levels: [
//                 {
//                     level: 0,
//                     format: "decimal" as const, // <-- PERBAIKAN DI SINI
//                     text: "%1.",
//                     alignment: AlignmentType.LEFT,
//                     style: { paragraph: { indent: { left: 720, hanging: 360 } } },
//                 },
//             ],
//         },
//     ],
// };

// // --- PARSER KONTEN TIPTAP ---
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; [key: string]: any };
// }

// async function nodeToDocx(node: TiptapNode, options: { isHeader?: boolean } = {}): Promise<(Paragraph | Table | Paragraph[]) | undefined> {
    
//     // Fungsi untuk membuat TextRun dari node Tiptap
//     const createTextRuns = (content: TiptapNode[] | undefined): TextRun[] => {
//         const textRuns: TextRun[] = [];
//         if (content) {
//             for (const child of content) {
//                 if (child.type === 'text' && child.text) {
//                     textRuns.push(new TextRun({
//                         text: child.text || "",
//                         bold: options.isHeader || child.marks?.some(m => m.type === 'bold'),
//                         italics: child.marks?.some(m => m.type === 'italic'),
//                     }));
//                 }
//             }
//         }
//         return textRuns.length === 0 ? [new TextRun("")] : textRuns;
//     };

//     switch (node.type) {
//         case 'paragraph':
//             return new Paragraph({ children: createTextRuns(node.content) });

//         case 'bulletList':
//         case 'orderedList':
//             const listItems: Paragraph[] = [];
//             if (node.content) {
//                 for (const listItemNode of node.content) { // <li>
//                     if (listItemNode.type === 'listItem' && listItemNode.content) {
//                         // Konten <li> biasanya <p>
//                         for (const itemContent of listItemNode.content) {
//                             if (itemContent.type === 'paragraph') {
//                                 listItems.push(new Paragraph({
//                                     children: createTextRuns(itemContent.content),
//                                     numbering: {
//                                         reference: node.type === 'bulletList' ? "my-bullet-points" : "my-ordered-list",
//                                         level: 0,
//                                     },
//                                 }));
//                             }
//                         }
//                     }
//                 }
//             }
//             return listItems; // Kembalikan sebagai array Paragraf

//         case 'image':
//             if (node.attrs?.src) {
//                 const imgBuffer = await fetchImage(node.attrs.src);
//                 if (imgBuffer) {
//                     return new Paragraph({
//                         children: [new ImageRun({ data: imgBuffer.toString("base64"), transformation: { width: 450, height: 300 } } as any)],
//                         alignment: AlignmentType.CENTER
//                     });
//                 }
//             }
//             return undefined;

//         case 'table':
//             const tableRows: TableRow[] = [];
//             if (node.content) {
//                 for (const rowNode of node.content) { 
//                     if (rowNode.type === 'tableRow' && rowNode.content) { 
//                         const cells: TableCell[] = [];
//                         for (const cellNode of rowNode.content) {
//                             if (cellNode.type === 'tableCell' || cellNode.type === 'tableHeader') {
//                                 const isHeader = cellNode.type === 'tableHeader';
//                                 const cellParagraphs: Paragraph[] = [];
//                                 if (cellNode.content) {
//                                     for (const cellContentNode of cellNode.content) {
//                                         const docxElement = await nodeToDocx(cellContentNode, { isHeader: isHeader });
//                                         if (docxElement) {
//                                             if (Array.isArray(docxElement)) {
//                                                 cellParagraphs.push(...docxElement);
//                                             } else if (docxElement instanceof Paragraph) {
//                                                 cellParagraphs.push(docxElement);
//                                             }
//                                         }
//                                     }
//                                 }
//                                 cells.push(new TableCell({
//                                     children: cellParagraphs.length === 0 ? [new Paragraph("")] : cellParagraphs,
//                                     borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                                     verticalAlign: VerticalAlign.CENTER,
//                                     margins: cellMargins,
//                                     shading: isHeader ? { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" } : undefined,
//                                 }));
//                             }
//                         }
//                         tableRows.push(new TableRow({ children: cells }));
//                     }
//                 }
//             }
//             return new Table({
//                 width: { size: 100, type: WidthType.PERCENTAGE },
//                 rows: tableRows,
//             });

//         default:
//             return new Paragraph({ children: createTextRuns(node.content) });
//     }
// }

// async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
//     const tableCells: TableCell[] = [];
//     if (!Array.isArray(sections)) { return tableCells; }
    
//     for (const section of sections) {
//         const sectionChildren: (Paragraph | Table)[] = [];
//         sectionChildren.push(new Paragraph({ children: [new TextRun({ text: section.label, bold: true })], spacing: { after: 100 } }));

//         const tiptapJson = section.content as TiptapNode;
//         if (tiptapJson && Array.isArray(tiptapJson.content)) {
//             for (const node of tiptapJson.content) {
//                 const docxElement = await nodeToDocx(node);
//                 if (docxElement) {
//                     if (Array.isArray(docxElement)) {
//                         sectionChildren.push(...docxElement);
//                     } else {
//                         sectionChildren.push(docxElement);
//                     }
//                 }
//             }
//         } else {
//             sectionChildren.push(new Paragraph(""));
//         }

//         tableCells.push(new TableCell({
//             children: sectionChildren,
//             borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//             columnSpan: 2,
//             margins: cellMargins,
//         }));
//     }
//     return tableCells;
// }

// // --- PARSER LAMPIRAN ---
// async function parseAttachments(attachments: any[]): Promise<Table[]> {
//     const attachmentContent: Paragraph[] = [];
//     if (!Array.isArray(attachments) || attachments.length === 0) {
//         return [];
//     }
//     attachmentContent.push(new Paragraph({
//         children: [new TextRun({ text: "Lampiran", bold: true })],
//         alignment: AlignmentType.LEFT,
//         spacing: { before: 200, after: 100 }
//     }));
//     for (const section of attachments) {
//         attachmentContent.push(new Paragraph({
//             children: [new TextRun({ text: `1. ${section.section_name}`, bold: false })],
//             spacing: { after: 100 }
//         }));
//         if (Array.isArray(section.files)) {
//             for (const file of section.files) {
//                 if (file.url) {
//                     const imgBuffer = await fetchImage(file.url);
//                     if (imgBuffer) {
//                         attachmentContent.push(new Paragraph({
//                             children: [new ImageRun({
//                                 data: imgBuffer.toString("base64"),
//                                 transformation: { width: 450, height: 300 }
//                             } as any)],
//                             alignment: AlignmentType.CENTER,
//                             spacing: { after: 100 }
//                         }));
//                     }
//                 }
//             }
//         }
//     }
//     const attachmentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: attachmentContent,
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     return [attachmentTable];
// }
// // --- AKHIR PARSER LAMPIRAN ---


// // --- API ROUTE UTAMA ---
// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) { return NextResponse.json({ error: "MOM ID is required" }, { status: 400 }); }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) { return NextResponse.json({ error: "MOM not found" }, { status: 404 }); }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const parsedContentTableCells = await parseTiptapContent(momData.content as any[] || []);
//     const attachmentTables = await parseAttachments(momData.attachments as any[]);

//     const attendeesText = momData.count_attendees || '(Tidak ada data peserta)';

//     // --- HEADER DOCX ---
//     const headerTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: defaultLogoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: defaultLogoBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }), new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }), ], width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: companyLogoApiBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: companyLogoApiBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                 ],
//             }),
//             new TableRow({
//                 children: [
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }), new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }), new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }), ], borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                 ],
//             }),
//         ],
//     });
//     // --- AKHIR HEADER DOCX ---

//     // --- TABEL NEXT ACTION ---
//     const nextActionTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [1000, 4000, 2500, 2500],
//         rows: [
//             new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph("No")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Action")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Due Date")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("UIC")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }),
//             ...(momData.next_actions || []).map((action: { action: string, target: string, pic: string }, index: number) => new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph(String(index + 1))], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.action)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.target)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.pic)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }))
//         ],
//         borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder }
//     });
//     // --- AKHIR TABEL NEXT ACTION ---

//     // --- TABEL UTAMA ---
//     const mainContentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             // BARIS 1: Attendees
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Attendees", bold: true })]
//                         })],
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         verticalAlign: VerticalAlign.CENTER,
//                         width: { size: 15, type: WidthType.PERCENTAGE },
//                         margins: cellMargins,
//                     }),
//                     new TableCell({
//                         children: [new Paragraph(attendeesText)],
//                         borders: { top: thinBlackBorder, left: noBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         width: { size: 85, type: WidthType.PERCENTAGE },
//                         verticalAlign: VerticalAlign.CENTER,
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 2: Result Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Result", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 3: Description Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Description", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         shading: { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 4 dst: Section Konten Tiptap
//             ...parsedContentTableCells.map(cell => new TableRow({ children: [cell] })),
            
//             // BARIS TERAKHIR KONTEN: Next Action Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({ children: [new TextRun({ text: "Next Action", bold: true })] })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             }),
//              // BARIS SETELAH Next Action Title: Tabel Next Action
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [nextActionTable],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     // --- AKHIR TABEL UTAMA ---

//     const doc = new Document({
//       numbering: numberingConfig, // <-- PERBAIKAN: Menggunakan config
//       sections: [{
//         headers: { 
//             default: new Header({ 
//                 children: [
//                     headerTable,
//                     new Paragraph({ text: "" })
//                 ] 
//             }) 
//         },
//         footers: { default: new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], italics: true }), ], }), ], }) },
        
//         properties: {
//             page: {
//                 margin: {
//                     top: 1440, 
//                     right: 1440,
//                     bottom: 1440,
//                     left: 1440,
//                 }
//             }
//         },

//         children: [
//             mainContentTable,
//             new Paragraph({ text: "", spacing: { before: 200 } }),
//             ...attachmentTables
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
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle, Header, Footer, PageNumber, IBorderOptions, ShadingType,
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
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; [key: string]: any };
// }

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
//             if (textRuns.length === 0) { textRuns.push(new TextRun("")); }
//             elements.push(new Paragraph({ children: textRuns }));
//             break;
//         case 'image':
//             if (node.attrs?.src) {
//                 const imgBuffer = await fetchImage(node.attrs.src);
//                 if (imgBuffer) {
//                     elements.push(new Paragraph({
//                         children: [new ImageRun({ data: imgBuffer.toString("base64"), transformation: { width: 450, height: 300 } } as any)],
//                         alignment: AlignmentType.CENTER
//                     }));
//                 }
//             }
//             break;
//         default:
//             if (node.text) { elements.push(new Paragraph({ children: [new TextRun(node.text)] })); }
//             break;
//     }
//     return elements;
// }

// // --- Style Border ---
// const thinBlackBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
// const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

// // --- Cell Margins ---
// const cellMargins = { top: 100, bottom: 100, left: 100, right: 100 };

// async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
//     const tableCells: TableCell[] = [];
//     if (!Array.isArray(sections)) { return tableCells; }
//     for (const section of sections) {
//         const sectionElements: Paragraph[] = [];
//         sectionElements.push(new Paragraph({ children: [new TextRun({ text: section.label, bold: true })], spacing: { after: 100 } }));
//         const tiptapJson = section.content as TiptapNode;
//         if (tiptapJson && Array.isArray(tiptapJson.content)) {
//             for (const node of tiptapJson.content) {
//                 const docxElements = await nodeToDocx(node);
//                 sectionElements.push(...docxElements);
//             }
//         } else { sectionElements.push(new Paragraph("")); }
//         tableCells.push(new TableCell({
//             children: sectionElements,
//             borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//             columnSpan: 2,
//             margins: cellMargins,
//         }));
//     }
//     return tableCells;
// }

// // --- PARSER LAMPIRAN ---
// async function parseAttachments(attachments: any[]): Promise<Table[]> {
//     const attachmentContent: Paragraph[] = [];
//     if (!Array.isArray(attachments) || attachments.length === 0) {
//         return [];
//     }
//     attachmentContent.push(new Paragraph({
//         children: [new TextRun({ text: "Lampiran", bold: true })],
//         alignment: AlignmentType.LEFT,
//         spacing: { before: 200, after: 100 }
//     }));
//     for (const section of attachments) {
//         attachmentContent.push(new Paragraph({
//             children: [new TextRun({ text: `1. ${section.section_name}`, bold: false })],
//             spacing: { after: 100 }
//         }));
//         if (Array.isArray(section.files)) {
//             for (const file of section.files) {
//                 if (file.url) {
//                     const imgBuffer = await fetchImage(file.url);
//                     if (imgBuffer) {
//                         attachmentContent.push(new Paragraph({
//                             children: [new ImageRun({
//                                 data: imgBuffer.toString("base64"),
//                                 transformation: { width: 450, height: 300 }
//                             } as any)],
//                             alignment: AlignmentType.CENTER,
//                             spacing: { after: 100 }
//                         }));
//                     }
//                 }
//             }
//         }
//     }
//     const attachmentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: attachmentContent,
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     return [attachmentTable];
// }
// // --- AKHIR PARSER LAMPIRAN ---


// // --- API ROUTE UTAMA ---
// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) { return NextResponse.json({ error: "MOM ID is required" }, { status: 400 }); }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) { return NextResponse.json({ error: "MOM not found" }, { status: 404 }); }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const parsedContentTableCells = await parseTiptapContent(momData.content as any[] || []);
//     const attachmentTables = await parseAttachments(momData.attachments as any[]);

//     const attendeesText = momData.count_attendees || '(Tidak ada data peserta)';

//     // --- HEADER DOCX ---
//     const headerTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: defaultLogoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: defaultLogoBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }), new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }), ], width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: companyLogoApiBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: companyLogoApiBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                 ],
//             }),
//             new TableRow({
//                 children: [
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }), new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }), new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }), ], borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                 ],
//             }),
//         ],
//     });
//     // --- AKHIR HEADER DOCX ---

//     // --- TABEL NEXT ACTION ---
//     const nextActionTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [1000, 4000, 2500, 2500],
//         rows: [
//             new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph("No")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Action")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Due Date")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("UIC")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }),
//             ...(momData.next_actions || []).map((action: { action: string, target: string, pic: string }, index: number) => new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph(String(index + 1))], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.action)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.target)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.pic)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }))
//         ],
//         borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder }
//     });
//     // --- AKHIR TABEL NEXT ACTION ---

//     // --- TABEL UTAMA ---
//     const mainContentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             // BARIS 1: Attendees
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Attendees", bold: true })]
//                         })],
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         verticalAlign: VerticalAlign.CENTER,
//                         width: { size: 15, type: WidthType.PERCENTAGE },
//                         margins: cellMargins,
//                     }),
//                     new TableCell({
//                         children: [new Paragraph(attendeesText)],
//                         borders: { top: thinBlackBorder, left: noBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         width: { size: 85, type: WidthType.PERCENTAGE },
//                         verticalAlign: VerticalAlign.CENTER,
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 2: Result Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Result", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 3: Description Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Description", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         shading: { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 4 dst: Section Konten Tiptap
//             ...parsedContentTableCells.map(cell => new TableRow({ children: [cell] })),
            
//             // BARIS TERAKHIR KONTEN: Next Action Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({ children: [new TextRun({ text: "Next Action", bold: true })] })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             }),
//              // BARIS SETELAH Next Action Title: Tabel Next Action
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [nextActionTable],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins, // <-- ⭐ PERBAIKAN DI SINI
//                     })
//                 ]
//             })
//         ]
//     });
//     // --- AKHIR TABEL UTAMA ---

//     const doc = new Document({
//       sections: [{
//         headers: { 
//             default: new Header({ 
//                 children: [
//                     headerTable,
//                     new Paragraph({ text: "" }) // Spasi di dalam header
//                 ] 
//             }) 
//         },
//         footers: { default: new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], italics: true }), ], }), ], }) },
        
//         properties: {
//             page: {
//                 margin: {
//                     top: 1440, // 1 inci default
//                     right: 1440,
//                     bottom: 1440,
//                     left: 1440,
//                 }
//             }
//         },

//         children: [
//             // Hapus spasi paragraf dari sini
//             mainContentTable,
//             new Paragraph({ text: "", spacing: { before: 200 } }),
//             ...attachmentTables
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
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle, Header, Footer, PageNumber, IBorderOptions, ShadingType,
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
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; [key: string]: any };
// }

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
//             if (textRuns.length === 0) { textRuns.push(new TextRun("")); }
//             elements.push(new Paragraph({ children: textRuns }));
//             break;
//         case 'image':
//             if (node.attrs?.src) {
//                 const imgBuffer = await fetchImage(node.attrs.src);
//                 if (imgBuffer) {
//                     elements.push(new Paragraph({
//                         children: [new ImageRun({ data: imgBuffer.toString("base64"), transformation: { width: 450, height: 300 } } as any)],
//                         alignment: AlignmentType.CENTER
//                     }));
//                 }
//             }
//             break;
//         default:
//             if (node.text) { elements.push(new Paragraph({ children: [new TextRun(node.text)] })); }
//             break;
//     }
//     return elements;
// }

// // --- Style Border ---
// const thinBlackBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
// const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

// // --- Cell Margins ---
// const cellMargins = { top: 100, bottom: 100, left: 100, right: 100 };

// async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
//     const tableCells: TableCell[] = [];
//     if (!Array.isArray(sections)) { return tableCells; }
//     for (const section of sections) {
//         const sectionElements: Paragraph[] = [];
//         sectionElements.push(new Paragraph({ children: [new TextRun({ text: section.label, bold: true })], spacing: { after: 100 } }));
//         const tiptapJson = section.content as TiptapNode;
//         if (tiptapJson && Array.isArray(tiptapJson.content)) {
//             for (const node of tiptapJson.content) {
//                 const docxElements = await nodeToDocx(node);
//                 sectionElements.push(...docxElements);
//             }
//         } else { sectionElements.push(new Paragraph("")); }
//         tableCells.push(new TableCell({
//             children: sectionElements,
//             borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//             columnSpan: 2,
//             margins: cellMargins,
//         }));
//     }
//     return tableCells;
// }

// // --- PARSER LAMPIRAN ---
// async function parseAttachments(attachments: any[]): Promise<Table[]> {
//     const attachmentContent: Paragraph[] = [];
//     if (!Array.isArray(attachments) || attachments.length === 0) {
//         return [];
//     }
//     attachmentContent.push(new Paragraph({
//         children: [new TextRun({ text: "Lampiran", bold: true })],
//         alignment: AlignmentType.LEFT,
//         spacing: { before: 200, after: 100 }
//     }));
//     for (const section of attachments) {
//         attachmentContent.push(new Paragraph({
//             children: [new TextRun({ text: `1. ${section.section_name}`, bold: false })],
//             spacing: { after: 100 }
//         }));
//         if (Array.isArray(section.files)) {
//             for (const file of section.files) {
//                 if (file.url) {
//                     const imgBuffer = await fetchImage(file.url);
//                     if (imgBuffer) {
//                         attachmentContent.push(new Paragraph({
//                             children: [new ImageRun({
//                                 data: imgBuffer.toString("base64"),
//                                 transformation: { width: 450, height: 300 }
//                             } as any)],
//                             alignment: AlignmentType.CENTER,
//                             spacing: { after: 100 }
//                         }));
//                     }
//                 }
//             }
//         }
//     }
//     const attachmentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: attachmentContent,
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     return [attachmentTable];
// }
// // --- AKHIR PARSER LAMPIRAN ---


// // --- API ROUTE UTAMA ---
// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) { return NextResponse.json({ error: "MOM ID is required" }, { status: 400 }); }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) { return NextResponse.json({ error: "MOM not found" }, { status: 404 }); }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const parsedContentTableCells = await parseTiptapContent(momData.content as any[] || []);
//     const attachmentTables = await parseAttachments(momData.attachments as any[]);

//     const attendeesText = momData.count_attendees || '(Tidak ada data peserta)';

//     // --- HEADER DOCX ---
//     const headerTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: defaultLogoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: defaultLogoBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }), new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }), ], width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: companyLogoApiBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: companyLogoApiBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                 ],
//             }),
//             new TableRow({
//                 children: [
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }), new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }), new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }), ], borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                 ],
//             }),
//         ],
//     });
//     // --- AKHIR HEADER DOCX ---

//     // --- TABEL NEXT ACTION ---
//     const nextActionTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [1000, 4000, 2500, 2500],
//         rows: [
//             // --- vvv TAMBAHKAN MARGINS DI SINI vvv ---
//             new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph("No")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Action")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Due Date")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("UIC")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }),
//             // --- vvv DAN TAMBAHKAN MARGINS DI SINI vvv ---
//             ...(momData.next_actions || []).map((action: { action: string, target: string, pic: string }, index: number) => new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph(String(index + 1))], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.action)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.target)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.pic)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }))
//         ],
//         borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder }
//     });
//     // --- AKHIR TABEL NEXT ACTION ---

//     // --- TABEL UTAMA ---
//     const mainContentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             // BARIS 1: Attendees
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Attendees", bold: true })]
//                         })],
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         verticalAlign: VerticalAlign.CENTER,
//                         width: { size: 15, type: WidthType.PERCENTAGE },
//                         margins: cellMargins,
//                     }),
//                     new TableCell({
//                         children: [new Paragraph(attendeesText)],
//                         borders: { top: thinBlackBorder, left: noBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         width: { size: 85, type: WidthType.PERCENTAGE },
//                         verticalAlign: VerticalAlign.CENTER,
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 2: Result Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Result", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 3: Description Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Description", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         shading: { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 4 dst: Section Konten Tiptap
//             ...parsedContentTableCells.map(cell => new TableRow({ children: [cell] })),
            
//             // BARIS TERAKHIR KONTEN: Next Action Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({ children: [new TextRun({ text: "Next Action", bold: true })] })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             }),
//              // BARIS SETELAH Next Action Title: Tabel Next Action
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [nextActionTable],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                     })
//                 ]
//             })
//         ]
//     });
//     // --- AKHIR TABEL UTAMA ---

//     const doc = new Document({
//       sections: [{
//         headers: { 
//             default: new Header({ 
//                 children: [
//                     headerTable,
//                     new Paragraph({ text: "" })
//                 ] 
//             }) 
//         },
//         footers: { default: new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], italics: true }), ], }), ], }) },
        
//         properties: {
//             page: {
//                 margin: {
//                     top: 1440,
//                     right: 1440,
//                     bottom: 1440,
//                     left: 1440,
//                 }
//             }
//         },

//         children: [
//             mainContentTable,
//             new Paragraph({ text: "", spacing: { before: 200 } }),
//             ...attachmentTables
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
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, VerticalAlign, BorderStyle, Header, Footer, PageNumber, IBorderOptions, ShadingType,
// } from "docx"; // Impor ShadingType
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
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; [key: string]: any };
// }

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
//             if (textRuns.length === 0) { textRuns.push(new TextRun("")); }
//             elements.push(new Paragraph({ children: textRuns }));
//             break;
//         case 'image':
//             if (node.attrs?.src) {
//                 const imgBuffer = await fetchImage(node.attrs.src);
//                 if (imgBuffer) {
//                     elements.push(new Paragraph({
//                         children: [new ImageRun({ data: imgBuffer.toString("base64"), transformation: { width: 450, height: 300 } } as any)],
//                         alignment: AlignmentType.CENTER
//                     }));
//                 }
//             }
//             break;
//         default:
//             if (node.text) { elements.push(new Paragraph({ children: [new TextRun(node.text)] })); }
//             break;
//     }
//     return elements;
// }

// // --- Style Border ---
// const thinBlackBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
// const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

// // --- Cell Margins ---
// const cellMargins = { top: 100, bottom: 100, left: 100, right: 100 };

// async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
//     const tableCells: TableCell[] = [];
//     if (!Array.isArray(sections)) { return tableCells; }
//     for (const section of sections) {
//         const sectionElements: Paragraph[] = [];
//         sectionElements.push(new Paragraph({ children: [new TextRun({ text: section.label, bold: true })], spacing: { after: 100 } }));
//         const tiptapJson = section.content as TiptapNode;
//         if (tiptapJson && Array.isArray(tiptapJson.content)) {
//             for (const node of tiptapJson.content) {
//                 const docxElements = await nodeToDocx(node);
//                 sectionElements.push(...docxElements);
//             }
//         } else { sectionElements.push(new Paragraph("")); }
//         tableCells.push(new TableCell({
//             children: sectionElements,
//             borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//             columnSpan: 2,
//             margins: cellMargins,
//         }));
//     }
//     return tableCells;
// }

// // --- PARSER LAMPIRAN ---
// async function parseAttachments(attachments: any[]): Promise<Table[]> {
//     const attachmentContent: Paragraph[] = [];
//     if (!Array.isArray(attachments) || attachments.length === 0) {
//         return [];
//     }
//     attachmentContent.push(new Paragraph({
//         children: [new TextRun({ text: "Lampiran", bold: true })],
//         alignment: AlignmentType.LEFT,
//         spacing: { before: 200, after: 100 }
//     }));
//     for (const section of attachments) {
//         attachmentContent.push(new Paragraph({
//             children: [new TextRun({ text: `1. ${section.section_name}`, bold: false })],
//             spacing: { after: 100 }
//         }));
//         if (Array.isArray(section.files)) {
//             for (const file of section.files) {
//                 if (file.url) {
//                     const imgBuffer = await fetchImage(file.url);
//                     if (imgBuffer) {
//                         attachmentContent.push(new Paragraph({
//                             children: [new ImageRun({
//                                 data: imgBuffer.toString("base64"),
//                                 transformation: { width: 450, height: 300 }
//                             } as any)],
//                             alignment: AlignmentType.CENTER,
//                             spacing: { after: 100 }
//                         }));
//                     }
//                 }
//             }
//         }
//     }
//     const attachmentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: attachmentContent,
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             })
//         ]
//     });
//     return [attachmentTable];
// }
// // --- AKHIR PARSER LAMPIRAN ---


// // --- API ROUTE UTAMA ---
// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) { return NextResponse.json({ error: "MOM ID is required" }, { status: 400 }); }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) { return NextResponse.json({ error: "MOM not found" }, { status: 404 }); }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//         momData.company?.logo_mitra_url ? fetchImage(momData.company.logo_mitra_url) : Promise.resolve(undefined),
//         readDefaultLogo()
//     ]);

//     const parsedContentTableCells = await parseTiptapContent(momData.content as any[] || []);
//     const attachmentTables = await parseAttachments(momData.attachments as any[]);

//     const attendeesText = momData.count_attendees || '(Tidak ada data peserta)';

//     // --- HEADER DOCX ---
//     const headerTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             new TableRow({
//                 children: [
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: defaultLogoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: defaultLogoBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo T-Sat", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ text: "MINUTE OF MEETING", heading: HeadingLevel.HEADING_5, alignment: AlignmentType.CENTER }), new Paragraph({ text: `Joint Planning Session Telkomsat & ${momData.company?.name || ''}`, alignment: AlignmentType.CENTER }), ], width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ verticalAlign: VerticalAlign.CENTER, children: companyLogoApiBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: companyLogoApiBuffer.toString("base64"), transformation: { width: 120, height: 60 } } as any)] })] : [new Paragraph({ text: "Logo Mitra", alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, verticalMerge: "restart", borders: { top: thinBlackBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: noBorder }, margins: cellMargins }),
//                 ],
//             }),
//             new TableRow({
//                 children: [
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [ new Paragraph({ children: [new TextRun("Date"), new TextRun("\t: "), new TextRun(new Date(momData.date).toLocaleDateString())] }), new Paragraph({ children: [new TextRun("Time"), new TextRun("\t: "), new TextRun(momData.time || '')] }), new Paragraph({ children: [new TextRun("Venue"), new TextRun("\t: "), new TextRun(momData.venue || '')] }), ], borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                     new TableCell({ children: [], verticalMerge: "continue", borders: { top: noBorder, left: thinBlackBorder, right: thinBlackBorder, bottom: thinBlackBorder }, margins: cellMargins }),
//                 ],
//             }),
//         ],
//     });
//     // --- AKHIR HEADER DOCX ---

//     // --- TABEL NEXT ACTION ---
//     const nextActionTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [1000, 4000, 2500, 2500],
//         rows: [
//             new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph("No")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Action")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("Due Date")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph("UIC")], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }),
//             ...(momData.next_actions || []).map((action: { action: string, target: string, pic: string }, index: number) => new TableRow({ children: [
//                 new TableCell({ children: [new Paragraph(String(index + 1))], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.action)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.target)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//                 new TableCell({ children: [new Paragraph(action.pic)], borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder }, margins: cellMargins }),
//             ] }))
//         ],
//         borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder }
//     });
//     // --- AKHIR TABEL NEXT ACTION ---

//     // --- TABEL UTAMA ---
//     const mainContentTable = new Table({
//         width: { size: 100, type: WidthType.PERCENTAGE },
//         rows: [
//             // BARIS 1: Attendees
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Attendees", bold: true })]
//                         })],
//                         borders: { top: thinBlackBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         verticalAlign: VerticalAlign.CENTER,
//                         width: { size: 15, type: WidthType.PERCENTAGE },
//                         margins: cellMargins,
//                     }),
//                     new TableCell({
//                         children: [new Paragraph(attendeesText)],
//                         borders: { top: thinBlackBorder, left: noBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         width: { size: 85, type: WidthType.PERCENTAGE },
//                         verticalAlign: VerticalAlign.CENTER,
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 2: Result Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Result", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 3: Description Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({
//                             alignment: AlignmentType.CENTER,
//                             children: [new TextRun({ text: "Description", bold: true })]
//                         })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                         shading: { type: ShadingType.SOLID, color: "D9D9D9", fill: "D9D9D9" },
//                         margins: cellMargins,
//                     }),
//                 ]
//             }),
//             // BARIS 4 dst: Section Konten Tiptap
//             ...parsedContentTableCells.map(cell => new TableRow({ children: [cell] })),
            
//             // BARIS TERAKHIR KONTEN: Next Action Title
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [new Paragraph({ children: [new TextRun({ text: "Next Action", bold: true })] })],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: noBorder, right: thinBlackBorder },
//                         margins: cellMargins,
//                     })
//                 ]
//             }),
//              // BARIS SETELAH Next Action Title: Tabel Next Action
//             new TableRow({
//                 children: [
//                     new TableCell({
//                         children: [nextActionTable],
//                         columnSpan: 2,
//                         borders: { top: noBorder, left: thinBlackBorder, bottom: thinBlackBorder, right: thinBlackBorder },
//                     })
//                 ]
//             })
//         ]
//     });
//     // --- AKHIR TABEL UTAMA ---

//     const doc = new Document({
//       sections: [{
//         // --- vvv PERUBAHAN DI SINI vvv ---
//         headers: { 
//             default: new Header({ 
//                 children: [
//                     headerTable,
//                     new Paragraph({ text: "" }) // Tambahkan paragraf kosong untuk spasi
//                 ] 
//             }) 
//         },
//         // --- ^^^ AKHIR PERUBAHAN ^^^ ---
//         footers: { default: new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], italics: true }), ], }), ], }) },
        
//         // Hapus page margin top yang sebelumnya kita coba
//         properties: {
//             page: {
//                 margin: {
//                     top: 1440, // Kembalikan ke 1 inci (default)
//                     right: 1440,
//                     bottom: 1440,
//                     left: 1440,
//                 }
//             }
//         },

//         children: [
//             // Hapus paragraf kosong yang sebelumnya ada di sini
//             mainContentTable,
//             new Paragraph({ text: "", spacing: { before: 200 } }),
//             ...attachmentTables
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
//   Document,
//   Packer,
//   Paragraph,
//   TextRun,
//   Table,
//   TableRow,
//   TableCell,
//   WidthType,
//   HeadingLevel,
//   AlignmentType,
//   ImageRun,
//   VerticalAlign,
//   BorderStyle,
//   Header,
//   Footer,
//   PageNumber,
//   IBorderOptions,
//   ShadingType,
// } from "docx";
// import fs from "node:fs/promises";
// import path from "node:path";

// // --- HELPER UNTUK GAMBAR & NAMA FILE ---
// async function fetchImage(url: string): Promise<Buffer | undefined> {
//   try {
//     const response = await fetch(url);
//     if (!response.ok) {
//       console.error(
//         `Gagal fetch image: ${response.status} ${response.statusText}`
//       );
//       return undefined;
//     }
//     const arrayBuffer = await response.arrayBuffer();
//     return Buffer.from(arrayBuffer);
//   } catch (error) {
//     console.error("Error fetching image:", error);
//     return undefined;
//   }
// }

// async function readDefaultLogo(): Promise<Buffer | undefined> {
//   try {
//     const logoPath = path.join(process.cwd(), "public", "logo_tsat.png");
//     const logoBuffer = await fs.readFile(logoPath);
//     return logoBuffer;
//   } catch (error) {
//     console.error("Error reading default logo (logo_tsat.png):", error);
//     return undefined;
//   }
// }

// function sanitizeFileName(name: string): string {
//   if (!name) return "";
//   return name.trim().replace(/[\\/:*?"<>|]/g, "_");
// }

// // --- PARSER KONTEN TIPTAP ---
// interface TiptapNode {
//   type: string;
//   content?: TiptapNode[];
//   text?: string;
//   marks?: { type: string }[];
//   attrs?: { src?: string; [key: string]: any };
// }

// async function nodeToDocx(node: TiptapNode): Promise<Paragraph[]> {
//   const elements: Paragraph[] = [];
//   switch (node.type) {
//     case "paragraph":
//       const textRuns: TextRun[] = [];
//       if (node.content) {
//         for (const child of node.content) {
//           if (child.type === "text" && child.text) {
//             textRuns.push(
//               new TextRun({
//                 text: child.text || "",
//                 bold: child.marks?.some((m) => m.type === "bold"),
//                 italics: child.marks?.some((m) => m.type === "italic"),
//               })
//             );
//           }
//         }
//       }
//       if (textRuns.length === 0) {
//         textRuns.push(new TextRun(""));
//       }
//       elements.push(new Paragraph({ children: textRuns }));
//       break;
//     case "image":
//       if (node.attrs?.src) {
//         const imgBuffer = await fetchImage(node.attrs.src);
//         if (imgBuffer) {
//           elements.push(
//             new Paragraph({
//               children: [
//                 new ImageRun({
//                   data: imgBuffer.toString("base64"),
//                   transformation: { width: 450, height: 300 },
//                 } as any),
//               ],
//               alignment: AlignmentType.CENTER,
//             })
//           );
//         }
//       }
//       break;
//     default:
//       if (node.text) {
//         elements.push(new Paragraph({ children: [new TextRun(node.text)] }));
//       }
//       break;
//   }
//   return elements;
// }

// // --- Style Border ---
// const thinBlackBorder: IBorderOptions = {
//   style: BorderStyle.SINGLE,
//   size: 6,
//   color: "000000",
// };
// const noBorder: IBorderOptions = {
//   style: BorderStyle.NONE,
//   size: 0,
//   color: "auto",
// };

// async function parseTiptapContent(sections: any[]): Promise<TableCell[]> {
//   const tableCells: TableCell[] = [];
//   if (!Array.isArray(sections)) {
//     return tableCells;
//   }
//   for (const section of sections) {
//     const sectionElements: Paragraph[] = [];
//     sectionElements.push(
//       new Paragraph({
//         children: [new TextRun({ text: section.label, bold: true })],
//         spacing: { after: 100 },
//       })
//     );
//     const tiptapJson = section.content as TiptapNode;
//     if (tiptapJson && Array.isArray(tiptapJson.content)) {
//       for (const node of tiptapJson.content) {
//         const docxElements = await nodeToDocx(node);
//         sectionElements.push(...docxElements);
//       }
//     } else {
//       sectionElements.push(new Paragraph(""));
//     }
//     tableCells.push(
//       new TableCell({
//         children: sectionElements,
//         borders: {
//           top: noBorder,
//           left: thinBlackBorder,
//           bottom: noBorder,
//           right: thinBlackBorder,
//         },
//         columnSpan: 2,
//       })
//     );
//   }
//   return tableCells;
// }

// // --- PARSER LAMPIRAN (DIMODIFIKASI UNTUK BORDER) ---
// async function parseAttachments(attachments: any[]): Promise<Table[]> {
//   const attachmentContent: Paragraph[] = [];
//   if (!Array.isArray(attachments) || attachments.length === 0) {
//     return [];
//   }
//   attachmentContent.push(
//     new Paragraph({
//       children: [new TextRun({ text: "Lampiran", bold: true })],
//       alignment: AlignmentType.LEFT,
//       spacing: { before: 200, after: 100 },
//     })
//   );
//   for (const section of attachments) {
//     attachmentContent.push(
//       new Paragraph({
//         children: [
//           new TextRun({ text: `1. ${section.section_name}`, bold: false }),
//         ],
//         spacing: { after: 100 },
//       })
//     );
//     if (Array.isArray(section.files)) {
//       for (const file of section.files) {
//         if (file.url) {
//           const imgBuffer = await fetchImage(file.url);
//           if (imgBuffer) {
//             attachmentContent.push(
//               new Paragraph({
//                 children: [
//                   new ImageRun({
//                     data: imgBuffer.toString("base64"),
//                     transformation: { width: 450, height: 300 },
//                   } as any),
//                 ],
//                 alignment: AlignmentType.CENTER,
//                 spacing: { after: 100 },
//               })
//             );
//           }
//         }
//       }
//     }
//   }
//   const attachmentTable = new Table({
//     width: { size: 100, type: WidthType.PERCENTAGE },
//     rows: [
//       new TableRow({
//         children: [
//           new TableCell({
//             children: attachmentContent,
//             borders: {
//               top: thinBlackBorder,
//               left: thinBlackBorder,
//               bottom: thinBlackBorder,
//               right: thinBlackBorder,
//             },
//             margins: { top: 100, bottom: 100, left: 100, right: 100 },
//           }),
//         ],
//       }),
//     ],
//   });
//   return [attachmentTable];
// }
// // --- AKHIR PARSER LAMPIRAN ---

// // --- API ROUTE UTAMA ---
// export async function POST(req: Request) {
//   try {
//     const body = await req.json();
//     const momId = body.momId;

//     if (!momId) {
//       return NextResponse.json(
//         { error: "MOM ID is required" },
//         { status: 400 }
//       );
//     }

//     const momData = await prisma.mom.findUnique({
//       where: { id: parseInt(momId as string) },
//       include: {
//         company: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     if (!momData) {
//       return NextResponse.json({ error: "MOM not found" }, { status: 404 });
//     }

//     const [companyLogoApiBuffer, defaultLogoBuffer] = await Promise.all([
//       momData.company?.logo_mitra_url
//         ? fetchImage(momData.company.logo_mitra_url)
//         : Promise.resolve(undefined),
//       readDefaultLogo(),
//     ]);

//     const parsedContentTableCells = await parseTiptapContent(
//       (momData.content as any[]) || []
//     );
//     const attachmentTables = await parseAttachments(
//       momData.attachments as any[]
//     );

//     const attendeesText = momData.count_attendees || "(Tidak ada data peserta)";

//     // --- HEADER DOCX (TETAP SAMA) ---
//     const headerTable = new Table({
//       width: { size: 100, type: WidthType.PERCENTAGE },
//       rows: [
//         new TableRow({
//           children: [
//             new TableCell({
//               verticalAlign: VerticalAlign.CENTER,
//               children: defaultLogoBuffer
//                 ? [
//                     new Paragraph({
//                       alignment: AlignmentType.CENTER,
//                       children: [
//                         new ImageRun({
//                           data: defaultLogoBuffer.toString("base64"),
//                           transformation: { width: 120, height: 60 },
//                         } as any),
//                       ],
//                     }),
//                   ]
//                 : [
//                     new Paragraph({
//                       text: "Logo T-Sat",
//                       alignment: AlignmentType.CENTER,
//                     }),
//                   ],
//               width: { size: 25, type: WidthType.PERCENTAGE },
//               verticalMerge: "restart",
//               borders: {
//                 top: thinBlackBorder,
//                 left: thinBlackBorder,
//                 right: thinBlackBorder,
//                 bottom: noBorder,
//               },
//             }),
//             new TableCell({
//               children: [
//                 new Paragraph({
//                   text: "MINUTE OF MEETING",
//                   heading: HeadingLevel.HEADING_5,
//                   alignment: AlignmentType.CENTER,
//                 }),
//                 new Paragraph({
//                   text: `Joint Planning Session Telkomsat & ${
//                     momData.company?.name || ""
//                   }`,
//                   alignment: AlignmentType.CENTER,
//                 }),
//               ],
//               width: { size: 50, type: WidthType.PERCENTAGE },
//               borders: {
//                 top: thinBlackBorder,
//                 left: thinBlackBorder,
//                 right: thinBlackBorder,
//                 bottom: thinBlackBorder,
//               },
//             }),
//             new TableCell({
//               verticalAlign: VerticalAlign.CENTER,
//               children: companyLogoApiBuffer
//                 ? [
//                     new Paragraph({
//                       alignment: AlignmentType.CENTER,
//                       children: [
//                         new ImageRun({
//                           data: companyLogoApiBuffer.toString("base64"),
//                           transformation: { width: 120, height: 60 },
//                         } as any),
//                       ],
//                     }),
//                   ]
//                 : [
//                     new Paragraph({
//                       text: "Logo Mitra",
//                       alignment: AlignmentType.CENTER,
//                     }),
//                   ],
//               width: { size: 25, type: WidthType.PERCENTAGE },
//               verticalMerge: "restart",
//               borders: {
//                 top: thinBlackBorder,
//                 left: thinBlackBorder,
//                 right: thinBlackBorder,
//                 bottom: noBorder,
//               },
//             }),
//           ],
//         }),
//         new TableRow({
//           children: [
//             new TableCell({
//               children: [],
//               verticalMerge: "continue",
//               borders: {
//                 top: noBorder,
//                 left: thinBlackBorder,
//                 right: thinBlackBorder,
//                 bottom: thinBlackBorder,
//               },
//             }),
//             new TableCell({
//               children: [
//                 new Paragraph({
//                   children: [
//                     new TextRun("Date"),
//                     new TextRun("\t: "),
//                     new TextRun(new Date(momData.date).toLocaleDateString()),
//                   ],
//                 }),
//                 new Paragraph({
//                   children: [
//                     new TextRun("Time"),
//                     new TextRun("\t: "),
//                     new TextRun(momData.time || ""),
//                   ],
//                 }),
//                 new Paragraph({
//                   children: [
//                     new TextRun("Venue"),
//                     new TextRun("\t: "),
//                     new TextRun(momData.venue || ""),
//                   ],
//                 }),
//               ],
//               borders: {
//                 top: noBorder,
//                 left: thinBlackBorder,
//                 right: thinBlackBorder,
//                 bottom: thinBlackBorder,
//               },
//             }),
//             new TableCell({
//               children: [],
//               verticalMerge: "continue",
//               borders: {
//                 top: noBorder,
//                 left: thinBlackBorder,
//                 right: thinBlackBorder,
//                 bottom: thinBlackBorder,
//               },
//             }),
//           ],
//         }),
//       ],
//     });
//     // --- AKHIR HEADER DOCX ---

//     // --- TABEL NEXT ACTION (UNTUK DIMASUKKAN KE TABEL UTAMA) ---
//     const nextActionTable = new Table({
//       width: { size: 100, type: WidthType.PERCENTAGE },
//       columnWidths: [1000, 4000, 2500, 2500],
//       rows: [
//         new TableRow({
//           children: [
//             new TableCell({
//               children: [new Paragraph("No")],
//               borders: {
//                 top: thinBlackBorder,
//                 left: thinBlackBorder,
//                 bottom: thinBlackBorder,
//                 right: thinBlackBorder,
//               },
//             }),
//             new TableCell({
//               children: [new Paragraph("Action")],
//               borders: {
//                 top: thinBlackBorder,
//                 left: thinBlackBorder,
//                 bottom: thinBlackBorder,
//                 right: thinBlackBorder,
//               },
//             }),
//             new TableCell({
//               children: [new Paragraph("Due Date")],
//               borders: {
//                 top: thinBlackBorder,
//                 left: thinBlackBorder,
//                 bottom: thinBlackBorder,
//                 right: thinBlackBorder,
//               },
//             }),
//             new TableCell({
//               children: [new Paragraph("UIC")],
//               borders: {
//                 top: thinBlackBorder,
//                 left: thinBlackBorder,
//                 bottom: thinBlackBorder,
//                 right: thinBlackBorder,
//               },
//             }),
//           ],
//         }),
//         ...(momData.next_actions || []).map(
//           (
//             action: { action: string; target: string; pic: string },
//             index: number
//           ) =>
//             new TableRow({
//               children: [
//                 new TableCell({
//                   children: [new Paragraph(String(index + 1))],
//                   borders: {
//                     top: thinBlackBorder,
//                     left: thinBlackBorder,
//                     bottom: thinBlackBorder,
//                     right: thinBlackBorder,
//                   },
//                 }),
//                 new TableCell({
//                   children: [new Paragraph(action.action)],
//                   borders: {
//                     top: thinBlackBorder,
//                     left: thinBlackBorder,
//                     bottom: thinBlackBorder,
//                     right: thinBlackBorder,
//                   },
//                 }),
//                 new TableCell({
//                   children: [new Paragraph(action.target)],
//                   borders: {
//                     top: thinBlackBorder,
//                     left: thinBlackBorder,
//                     bottom: thinBlackBorder,
//                     right: thinBlackBorder,
//                   },
//                 }),
//                 new TableCell({
//                   children: [new Paragraph(action.pic)],
//                   borders: {
//                     top: thinBlackBorder,
//                     left: thinBlackBorder,
//                     bottom: thinBlackBorder,
//                     right: thinBlackBorder,
//                   },
//                 }),
//               ],
//             })
//         ),
//       ],
//       borders: {
//         top: noBorder,
//         left: noBorder,
//         bottom: noBorder,
//         right: noBorder,
//       },
//     });
//     // --- AKHIR TABEL NEXT ACTION ---

//     // --- TABEL UTAMA YANG MEMBUNGKUS SEMUA KONTEN ---
//     const mainContentTable = new Table({
//       width: { size: 100, type: WidthType.PERCENTAGE },
//       rows: [
//         // BARIS 1: Attendees
//         new TableRow({
//           children: [
//             new TableCell({
//               children: [
//                 // --- vvv PERUBAHAN DI SINI vvv ---
//                 new Paragraph({
//                   // text: "Attendees", // Hapus baris ini
//                   alignment: AlignmentType.CENTER,
//                   children: [
//                     // Gunakan 'children'
//                     new TextRun({
//                       text: "Attendees",
//                       bold: true, // Pindahkan bold ke TextRun
//                     }),
//                   ],
//                   // bold: true // Hapus baris ini
//                 }),
//                 // --- ^^^ AKHIR PERUBAHAN ^^^ ---
//               ],
//               borders: {
//                 top: thinBlackBorder,
//                 left: thinBlackBorder,
//                 bottom: thinBlackBorder,
//                 right: thinBlackBorder,
//               },
//               verticalAlign: VerticalAlign.CENTER,
//               width: { size: 25, type: WidthType.PERCENTAGE },
//             }),
//             // --- ^^^ AKHIR PERUBAHAN ^^^ ---
//             new TableCell({
//               children: [new Paragraph(attendeesText)],
//               borders: {
//                 top: thinBlackBorder,
//                 left: noBorder,
//                 bottom: thinBlackBorder,
//                 right: thinBlackBorder,
//               },
//               width: { size: 75, type: WidthType.PERCENTAGE },
//               verticalAlign: VerticalAlign.CENTER,
//             }),
//           ],
//         }),

//         // --- vvv PERUBAHAN DI SINI vvv ---
//         // BARIS 2: Result Title
//         new TableRow({
//           children: [
//             new TableCell({
//               children: [
//                 new Paragraph({
//                   text: "Result",
//                   alignment: AlignmentType.CENTER, // Tambahkan alignment center
//                 }),
//               ],
//               columnSpan: 2,
//               borders: {
//                 top: noBorder,
//                 left: thinBlackBorder,
//                 bottom: thinBlackBorder,
//                 right: thinBlackBorder,
//               },
//             }),
//           ],
//         }),
//         // BARIS 3: Description Title
//         new TableRow({
//           children: [
//             new TableCell({
//               children: [
//                 new Paragraph({
//                   text: "Description",
//                   alignment: AlignmentType.CENTER, // Tambahkan alignment center
//                 }),
//               ],
//               columnSpan: 2,
//               borders: {
//                 top: noBorder,
//                 left: thinBlackBorder,
//                 bottom: thinBlackBorder,
//                 right: thinBlackBorder,
//               },
//               shading: {
//                 type: ShadingType.SOLID,
//                 color: "D9D9D9", // Warna abu-abu (sesuai contoh)
//                 fill: "D9D9D9",
//                 },
//             }),
//           ],
//         }),
//         // --- ^^^ AKHIR PERUBAHAN ^^^ ---

//         // BARIS 4 dst: Section Konten dari Tiptap
//         ...parsedContentTableCells.map(
//           (cell) => new TableRow({ children: [cell] })
//         ),

//         // BARIS TERAKHIR KONTEN: Next Action Title
//         new TableRow({
//           children: [
//             new TableCell({
//               children: [
//                 new Paragraph({
//                   children: [new TextRun({ text: "Next Action", bold: true })],
//                 }),
//               ],
//               columnSpan: 2,
//               borders: {
//                 top: noBorder,
//                 left: thinBlackBorder,
//                 bottom: noBorder,
//                 right: thinBlackBorder,
//               },
//             }),
//           ],
//         }),
//         // BARIS SETELAH Next Action Title: Tabel Next Action itu sendiri
//         new TableRow({
//           children: [
//             new TableCell({
//               children: [nextActionTable],
//               columnSpan: 2,
//               borders: {
//                 top: noBorder,
//                 left: thinBlackBorder,
//                 bottom: thinBlackBorder,
//                 right: thinBlackBorder,
//               },
//             }),
//           ],
//         }),
//       ],
//     });
//     // --- AKHIR TABEL UTAMA ---

//     const doc = new Document({
//       sections: [
//         {
//           headers: { default: new Header({ children: [headerTable] }) },
//           footers: {
//             default: new Footer({
//               children: [
//                 new Paragraph({
//                   alignment: AlignmentType.RIGHT,
//                   children: [
//                     new TextRun({
//                       children: [
//                         "Page ",
//                         PageNumber.CURRENT,
//                         " of ",
//                         PageNumber.TOTAL_PAGES,
//                       ],
//                       italics: true,
//                     }),
//                   ],
//                 }),
//               ],
//             }),
//           },

//           properties: {
//             page: {
//               margin: {
//                 // Jarak atas (header) untuk semua halaman
//                 top: 2160, // 1.5 inci
//                 right: 1440,
//                 bottom: 1440,
//                 left: 1440,
//               },
//             },
//           },

//           children: [
//             // (Paragraf kosong untuk spasi Halaman 1 dihilangkan, diganti oleh margin atas)

//             // --- MASUKKAN TABEL UTAMA ---
//             mainContentTable,

//             // --- TAMBAHKAN JARAK SEBELUM LAMPIRAN ---
//             new Paragraph({ text: "", spacing: { before: 200 } }),

//             // --- MASUKKAN TABEL LAMPIRAN ---
//             ...attachmentTables,
//           ],
//         },
//       ],
//     });

//     const buffer = await Packer.toBuffer(doc);
//     const momTitleSanitized = sanitizeFileName(momData.title || "MOM");
//     const companyNameSanitized = sanitizeFileName(
//       momData.company?.name || "Generated"
//     );
//     const fileName = `MOM-${momTitleSanitized}-${companyNameSanitized}.docx`;

//     return new NextResponse(Uint8Array.from(buffer), {
//       status: 200,
//       headers: {
//         "Content-Type":
//           "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//         "Content-Disposition": `attachment; filename="${fileName}"`,
//       },
//     });
//   } catch (error: any) {
//     console.error("Error generating DOCX:", error);
//     return NextResponse.json(
//       { error: "Failed to generate DOCX", details: error.message },
//       { status: 500 }
//     );
//   }
// }
