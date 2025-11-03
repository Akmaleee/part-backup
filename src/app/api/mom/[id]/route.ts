import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/postgres";
import { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * ============================================================================
 * HANDLER GET: Mengambil satu MOM berdasarkan ID
 * ============================================================================
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const momId = parseInt(params.id);
    if (isNaN(momId)) {
      return NextResponse.json({ error: "Invalid MOM ID" }, { status: 400 });
    }

    const mom = await prisma.mom.findUnique({
      where: { id: momId },
      include: {
        company: true,
        progress: {
          include: {
            step: true,
            status: true,
          },
        },
        approvers: true,
        next_actions: true,
        attachments: {
          include: {
            files: true,
          },
        },
      },
    });

    if (!mom) {
      return NextResponse.json({ error: "MOM not found" }, { status: 404 });
    }

    const formattedAttachments = (mom.attachments || []).map((section: any) => ({
      ...section,
      sectionName: section.section_name,
      files: (section.files || []).map((file: any) => ({
        ...file,
        fileName: file.file_name,
      })),
    }));

    return NextResponse.json({ ...mom, attachments: formattedAttachments });

  } catch (error) {
    console.error("Error fetching MOM:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * ============================================================================
 * HANDLER PUT: Meng-update MOM yang ada
 * ============================================================================
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const momId = parseInt(params.id);
    if (isNaN(momId)) {
      return NextResponse.json({ error: "Invalid MOM ID" }, { status: 400 });
    }

    const body = await request.json();

    const {
      attachments,
      approvers,
      nextActions,
      companyId,
      judul,
      tanggalMom,
      waktu,
      venue,
      peserta,
      content,
      is_finish, // ✅ 1. Ambil flag 'is_finish' dari body
    } = body;

    if (!judul || !companyId || !tanggalMom || !venue) {
      return NextResponse.json(
        { error: "Field wajib (judul, company, tanggal, venue) harus diisi." },
        { status: 400 }
      );
    }

    const transaction = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      
      // 1. HAPUS SEMUA RELASI LAMA
      await tx.momAttachmentFile.deleteMany({
        where: { section: { mom_id: momId } },
      });
      await tx.momAttachmentSection.deleteMany({
        where: { mom_id: momId },
      });
      await tx.approver.deleteMany({
        where: { mom_id: momId },
      });
      await tx.nextAction.deleteMany({
        where: { mom_id: momId },
      });

      // 2. UPDATE DATA UTAMA MOM & BUAT ULANG RELASI
      const updatedMom = await tx.mom.update({
        where: { id: momId },
        data: {
          title: judul,
          company_id: Number(companyId),
          date: new Date(tanggalMom),
          time: waktu,
          venue: venue,
          count_attendees: peserta,
          content: content,
          
          attachments: {
            create: (attachments ?? []).map((section: any) => ({
              section_name: section.sectionName,
              files: {
                create: (section.files ?? []).map((file: any) => ({
                  file_name: file.file_name || file.name, 
                  url: file.url,
                })),
              },
            })),
          },
          approvers: {
            create: (approvers ?? []).map((approver: any) => ({
              name: approver.name,
              email: approver.email,
              type: approver.type,
            })),
          },
          next_actions: {
            create: (nextActions ?? []).map((action: any) => ({
              action: action.action,
              target: action.target,
              pic: action.pic,
            })),
          },
        },
        // Kita perlu 'progress_id' untuk langkah selanjutnya
        include: {
          attachments: { include: { files: true } },
          approvers: true,
          next_actions: true,
          progress: true, // Pastikan 'progress_id' ter-load
        }
      });

      // ✅ 2. LOGIKA BARU UNTUK UPDATE STATUS
      // Cek jika tombol "Update & Finish" (is_finish == 1) ditekan
      // dan MOM ini memiliki data progress (progress_id)
      if (is_finish && updatedMom.progress_id) {
        await tx.progress.update({
          where: { id: updatedMom.progress_id },
          data: {
            // Asumsi ID 1 = "Review Mitra" (atau step pertama setelah draft)
            step_id: 1, 
            // Asumsi ID 1 = "Pending" (status default untuk step baru)
            status_id: 1,
          },
        });
      }

      return updatedMom;
    });

    return NextResponse.json(transaction, { status: 200 });

  } catch (error: any) {
    console.error("Error updating MOM:", error);
    if (error.name === 'ZodError' || error.code === 'P2023') {
      return NextResponse.json({ error: "Data tidak valid.", details: error.message }, { status: 400 });
    }
    if (error.message.includes("Invalid Date")) {
       return NextResponse.json({ error: "Format tanggal tidak valid." }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * ============================================================================
 * HANDLER DELETE: Menghapus MOM berdasarkan ID
 * ============================================================================
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const momId = parseInt(params.id);
    if (isNaN(momId)) {
      return NextResponse.json({ error: "Invalid MOM ID" }, { status: 400 });
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Hapus relasi
      await tx.momAttachmentFile.deleteMany({
        where: { section: { mom_id: momId } },
      });
      await tx.momAttachmentSection.deleteMany({
        where: { mom_id: momId },
      });
      await tx.approver.deleteMany({
        where: { mom_id: momId },
      });
      await tx.nextAction.deleteMany({
        where: { mom_id: momId },
      });
      
      await tx.progress.deleteMany({
        where: { 
          moms: {
            some: {
              id: momId
            }
          }
        } 
      });
      
      // 2. Hapus MOM utama
      await tx.mom.delete({
        where: { id: momId },
      });
    });

    return NextResponse.json(
      { message: "MOM berhasil dihapus" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error deleting MOM:", error);
    if (error.code === 'P2025') { // Record not found
       return NextResponse.json({ error: "MOM tidak ditemukan" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// import { NextRequest, NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma/postgres";
// import { Prisma } from "@prisma/client";
// import { z } from "zod";

// /**
//  * ============================================================================
//  * HANDLER GET: Mengambil satu MOM berdasarkan ID
//  * ============================================================================
//  */
// export async function GET(
//   request: NextRequest,
//   { params }: { params: { id: string } }
// ) {
//   try {
//     const momId = parseInt(params.id);
//     if (isNaN(momId)) {
//       return NextResponse.json({ error: "Invalid MOM ID" }, { status: 400 });
//     }

//     const mom = await prisma.mom.findUnique({
//       where: { id: momId },
//       include: {
//         company: true,
//         progress: {
//           include: {
//             step: true,
//             status: true,
//           },
//         },
//         approvers: true,
//         next_actions: true,
//         attachments: {
//           include: {
//             files: true,
//           },
//         },
//       },
//     });

//     if (!mom) {
//       return NextResponse.json({ error: "MOM not found" }, { status: 404 });
//     }

//     const formattedAttachments = (mom.attachments || []).map((section: any) => ({
//       ...section,
//       sectionName: section.section_name,
//       files: (section.files || []).map((file: any) => ({
//         ...file,
//         fileName: file.file_name,
//       })),
//     }));

//     return NextResponse.json({ ...mom, attachments: formattedAttachments });

//   } catch (error) {
//     console.error("Error fetching MOM:", error);
//     return NextResponse.json(
//       { error: "Internal server error" },
//       { status: 500 }
//     );
//   }
// }

// /**
//  * ============================================================================
//  * HANDLER PUT: Meng-update MOM yang ada
//  * ============================================================================
//  */
// export async function PUT(
//   request: NextRequest,
//   { params }: { params: { id: string } }
// ) {
//   try {
//     const momId = parseInt(params.id);
//     if (isNaN(momId)) {
//       return NextResponse.json({ error: "Invalid MOM ID" }, { status: 400 });
//     }

//     const body = await request.json();

//     const {
//       attachments,
//       approvers,
//       nextActions,
//       companyId,
//       judul,
//       tanggalMom,
//       waktu,
//       venue,
//       peserta,
//       content,
//     } = body;

//     if (!judul || !companyId || !tanggalMom || !venue) {
//       return NextResponse.json(
//         { error: "Field wajib (judul, company, tanggal, venue) harus diisi." },
//         { status: 400 }
//       );
//     }

//     const transaction = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      
//       // 1. HAPUS SEMUA RELASI LAMA
//       await tx.momAttachmentFile.deleteMany({
//         where: { section: { mom_id: momId } },
//       });
//       await tx.momAttachmentSection.deleteMany({
//         where: { mom_id: momId },
//       });
//       await tx.approver.deleteMany({
//         where: { mom_id: momId },
//       });
//       await tx.nextAction.deleteMany({
//         where: { mom_id: momId },
//       });

//       // 2. UPDATE DATA UTAMA MOM & BUAT ULANG RELASI
//       const updatedMom = await tx.mom.update({
//         where: { id: momId },
//         data: {
//           title: judul,
//           company_id: Number(companyId),
//           date: new Date(tanggalMom),
//           time: waktu,
//           venue: venue,
//           count_attendees: peserta,
//           content: content,
          
//           attachments: {
//             create: (attachments ?? []).map((section: any) => ({
//               section_name: section.sectionName,
//               files: {
//                 create: (section.files ?? []).map((file: any) => ({
//                   file_name: file.file_name || file.name, 
//                   url: file.url,
//                 })),
//               },
//             })),
//           },

//           approvers: {
//             create: (approvers ?? []).map((approver: any) => ({
//               name: approver.name,
//               email: approver.email,
//               type: approver.type,
//             })),
//           },
          
//           next_actions: {
//             create: (nextActions ?? []).map((action: any) => ({
//               action: action.action,
//               target: action.target,
//               pic: action.pic,
//             })),
//           },
//         },
//         include: {
//           attachments: { include: { files: true } },
//           approvers: true,
//           next_actions: true,
//         }
//       });

//       return updatedMom;
//     });

//     return NextResponse.json(transaction, { status: 200 });

//   } catch (error: any) {
//     console.error("Error updating MOM:", error);
//     if (error.name === 'ZodError' || error.code === 'P2023') {
//       return NextResponse.json({ error: "Data tidak valid.", details: error.message }, { status: 400 });
//     }
//     if (error.message.includes("Invalid Date")) {
//        return NextResponse.json({ error: "Format tanggal tidak valid." }, { status: 400 });
//     }
//     return NextResponse.json(
//       { error: "Internal server error" },
//       { status: 500 }
//     );
//   }
// }

// /**
//  * ============================================================================
//  * HANDLER DELETE: Menghapus MOM berdasarkan ID
//  * ============================================================================
//  */
// export async function DELETE(
//   request: NextRequest,
//   { params }: { params: { id: string } }
// ) {
//   try {
//     const momId = parseInt(params.id);
//     if (isNaN(momId)) {
//       return NextResponse.json({ error: "Invalid MOM ID" }, { status: 400 });
//     }

//     await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
//       // 1. Hapus relasi
//       await tx.momAttachmentFile.deleteMany({
//         where: { section: { mom_id: momId } },
//       });
//       await tx.momAttachmentSection.deleteMany({
//         where: { mom_id: momId },
//       });
//       await tx.approver.deleteMany({
//         where: { mom_id: momId },
//       });
//       await tx.nextAction.deleteMany({
//         where: { mom_id: momId },
//       });
      
//       // ✅ PERBAIKAN DI SINI: Gunakan 'moms' (plural) dan filter 'some'
//       await tx.progress.deleteMany({
//         where: { 
//           moms: {         // Sesuai schema
//             some: {         // Filter berdasarkan relasi many-to-many
//               id: momId
//             }
//           }
//         } 
//       });
      
//       // 2. Hapus MOM utama
//       await tx.mom.delete({
//         where: { id: momId },
//       });
//     });

//     return NextResponse.json(
//       { message: "MOM berhasil dihapus" },
//       { status: 200 }
//     );
//   } catch (error: any) {
//     console.error("Error deleting MOM:", error);
//     if (error.code === 'P2025') { // Record not found
//        return NextResponse.json({ error: "MOM tidak ditemukan" }, { status: 404 });
//     }
//     return NextResponse.json(
//       { error: "Internal server error" },
//       { status: 500 }
//     );
//   }
// }

// import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma/postgres";

// // FUNGSI: GET (Untuk mengambil 1 MOM berdasarkan ID)
// export async function GET(
//   req: Request,
//   { params }: { params: { id: string } }
// ) {
//   try {
//     const momId = parseInt(params.id, 10);
//     if (isNaN(momId)) {
//       return NextResponse.json({ error: "ID MOM tidak valid" }, { status: 400 });
//     }

//     const mom = await prisma.mom.findUnique({
//       where: { id: momId },
//       include: {
//         company: true,
//         approvers: true,
//         next_actions: true,
//         attachments: { // Ini adalah relasi 'attachments' di model 'Mom'
//           include: {
//             files: true, // Ini adalah relasi 'files' di model 'MomAttachmentSection'
//           },
//         },
//       },
//     });

//     if (!mom) {
//       return NextResponse.json({ error: "MOM tidak ditemukan" }, { status: 404 });
//     }

//     return NextResponse.json(mom);
//   } catch (error: any) {
//     console.error("Gagal mengambil MOM:", error);
//     return NextResponse.json(
//       { error: "Gagal mengambil data MOM", details: error.message },
//       { status: 500 }
//     );
//   }
// }

// // FUNGSI: PUT (Untuk meng-update 1 MOM berdasarkan ID)
// export async function PUT(
//   req: Request,
//   { params }: { params: { id: string } }
// ) {
//   try {
//     const momId = parseInt(params.id, 10);
//     if (isNaN(momId)) {
//       return NextResponse.json({ error: "ID MOM tidak valid" }, { status: 400 });
//     }

//     const body = await req.json();
//     const {
//       companyId,
//       judul,
//       tanggalMom,
//       peserta,
//       venue,
//       waktu,
//       content,
//       approvers,
//       attachments,
//       nextActions,
//       is_finish,
//     } = body;

//     // 1. Hapus data relasional lama
//     await prisma.approver.deleteMany({ where: { mom_id: momId } });
//     await prisma.nextAction.deleteMany({ where: { mom_id: momId } });
    
//     // (Logika update/delete attachment lebih kompleks, kita abaikan dulu)
//     // Jika Anda ingin mengupdate attachment, Anda perlu:
//     // 1. Mengambil attachment sections yang ada.
//     // 2. Membandingkan dengan 'attachments' dari body.
//     // 3. Menghapus files/sections yang tidak ada di body.
//     // 4. Membuat yang baru.

//     // 2. Format data baru
//     const formattedApprovers = approvers.map(
//       (a: { name: string; email: string; type: string }) => ({
//         name: a.name,
//         email: a.email,
//         type: a.type,
//       })
//     );

//     const formattedNextActions = nextActions
//       .filter(
//         (a: { action: string; target: string; pic: string }) =>
//           a.action?.trim() || a.target?.trim() || a.pic?.trim()
//       )
//       .map((a: { action: string; target: string; pic: string }) => ({
//         action: a.action,
//         target: a.target,
//         pic: a.pic,
//       }));

//     // 3. Dapatkan data progress yang ada
//     const existingMom = await prisma.mom.findUnique({ 
//         where: { id: momId }, 
//         select: { progress_id: true } 
//     });
    
//     let newProgressId = existingMom?.progress_id;

//     // Logika update/create progress_id
//     if (is_finish === 1) {
//         if (existingMom?.progress_id) {
//             await prisma.progress.update({
//                 where: { id: existingMom.progress_id },
//                 data: { status_id: 1 } // Asumsi 1 = Selesai
//             });
//         } else {
//             const newProgress = await prisma.progress.create({
//                 data: {
//                     company_id: Number(companyId),
//                     step_id: 1, // step MOM
//                     status_id: 1, // Selesai
//                 }
//             });
//             newProgressId = newProgress.id;
//         }
//     } else {
//         if (existingMom?.progress_id) {
//              await prisma.progress.update({
//                 where: { id: existingMom.progress_id },
//                 data: { status_id: null } // Draft
//             });
//         }
//     }

//     // 4. Update data MOM
//     const updatedMom = await prisma.mom.update({
//       where: { id: momId },
//       data: {
//         company_id: Number(companyId),
//         title: judul || "",
//         date: new Date(tanggalMom),
//         time: waktu || "",
//         venue: venue || "",
//         count_attendees: peserta || "",
//         content: content || [],
//         progress_id: newProgressId,

//         approvers: {
//           create: formattedApprovers,
//         },
//         next_actions: {
//           create: formattedNextActions, 
//         },
//       },
//       include: {
//         approvers: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     return NextResponse.json({ message: "MOM berhasil di-update", data: updatedMom });
//   } catch (error: any) {
//     console.error("Gagal meng-update MOM:", error);
//     if (error.name === 'PrismaClientValidationError') {
//          console.error("Kesalahan Validasi Prisma:", error.message);
//          return NextResponse.json({ error: "Kesalahan Validasi Data.", details: error.message }, { status: 400 });
//     }
//     return NextResponse.json(
//       { error: "Gagal meng-update MOM", details: error.message },
//       { status: 500 }
//     );
//   }
// }

// // --- [PERBAIKAN FUNGSI DELETE] ---
// export async function DELETE(
//   req: Request,
//   { params }: { params: { id: string } }
// ) {
//   try {
//     const momId = parseInt(params.id, 10);
//     if (isNaN(momId)) {
//       return NextResponse.json({ error: "ID MOM tidak valid" }, { status: 400 });
//     }

//     // 1. Ambil data MOM (termasuk progress_id-nya)
//     const mom = await prisma.mom.findUnique({ 
//       where: { id: momId }, 
//       select: { progress_id: true } 
//     });

//     if (!mom) {
//       return NextResponse.json({ error: "MOM tidak ditemukan untuk dihapus" }, { status: 404 });
//     }

//     // 2. Hapus relasi anak (1-ke-N)
//     await prisma.approver.deleteMany({ where: { mom_id: momId } });
//     await prisma.nextAction.deleteMany({ where: { mom_id: momId } });

//     // 3. Hapus relasi lampiran (Berjenjang)
    
//     // 3a. Cari semua 'Section' yang terkait dengan MOM ini
//     const sections = await prisma.momAttachmentSection.findMany({
//       where: { mom_id: momId },
//       select: { id: true }
//     });
//     const sectionIds = sections.map(s => s.id);

//     // 3b. Hapus semua 'Files' yang terkait dengan 'Sections' tersebut
//     if (sectionIds.length > 0) {
//       await prisma.momAttachmentFile.deleteMany({
//         where: { section_id: { in: sectionIds } } // Hapus berdasarkan 'section_id'
//       });
//     }

//     // 3c. Hapus 'Sections' itu sendiri (Menggunakan nama model yang benar)
//     await prisma.momAttachmentSection.deleteMany({
//       where: { mom_id: momId }
//     });

//     // 4. Hapus MOM utama
//     await prisma.mom.delete({
//       where: { id: momId },
//     });

//     // 5. (Opsional) Hapus 'Progress'
//     if (mom.progress_id) {
//       try {
//         await prisma.progress.delete({ where: { id: mom.progress_id } });
//       } catch (progressError) {
//         console.warn(`Gagal menghapus progress record ${mom.progress_id}:`, progressError);
//       }
//     }

//     return NextResponse.json({ message: "MOM berhasil dihapus" }, { status: 200 });

//   } catch (error: any) {
//     console.error("Gagal menghapus MOM:", error);
//     if (error.code === 'P2025') { 
//         return NextResponse.json({ error: "Gagal menghapus relasi, data tidak ditemukan" }, { status: 404 });
//     }
//     return NextResponse.json(
//       { error: "Gagal menghapus MOM", details: error.message },
//       { status: 500 }
//     );
//   }
// }

// import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma/postgres";

// // FUNGSI: GET (Untuk mengambil 1 MOM berdasarkan ID)
// export async function GET(
//   req: Request,
//   { params }: { params: { id: string } }
// ) {
//   try {
//     const momId = parseInt(params.id, 10);
//     if (isNaN(momId)) {
//       return NextResponse.json({ error: "ID MOM tidak valid" }, { status: 400 });
//     }

//     const mom = await prisma.mom.findUnique({
//       where: { id: momId },
//       include: {
//         company: true,
//         approvers: true,
//         next_actions: true,
//         attachments: {
//           include: {
//             files: true,
//           },
//         },
//       },
//     });

//     if (!mom) {
//       return NextResponse.json({ error: "MOM tidak ditemukan" }, { status: 404 });
//     }

//     return NextResponse.json(mom);
//   } catch (error: any) {
//     console.error("Gagal mengambil MOM:", error);
//     return NextResponse.json(
//       { error: "Gagal mengambil data MOM", details: error.message },
//       { status: 500 }
//     );
//   }
// }

// // FUNGSI: PUT (Untuk meng-update 1 MOM berdasarkan ID)
// export async function PUT(
//   req: Request,
//   { params }: { params: { id: string } }
// ) {
//   try {
//     const momId = parseInt(params.id, 10);
//     if (isNaN(momId)) {
//       return NextResponse.json({ error: "ID MOM tidak valid" }, { status: 400 });
//     }

//     const body = await req.json();
//     const {
//       companyId,
//       judul,
//       tanggalMom,
//       peserta,
//       venue,
//       waktu,
//       content,
//       approvers,
//       attachments,
//       nextActions, // Ini adalah array mentah dari frontend
//       is_finish,
//     } = body;

//     // 1. Hapus data relasional lama (simple approach)
//     await prisma.approver.deleteMany({ where: { mom_id: momId } });
//     await prisma.nextAction.deleteMany({ where: { mom_id: momId } });
//     // (Logika delete/update attachment lebih kompleks)

//     // 2. Format data baru
//     const formattedApprovers = approvers.map(
//       (a: { name: string; email: string; type: string }) => ({
//         name: a.name,
//         email: a.email,
//         type: a.type,
//       })
//     );

//     // --- PERBAIKAN DI SINI ---
//     // Filter dan map 'nextActions' untuk menghapus 'id' atau field lain
//     // yang tidak diinginkan oleh Prisma 'create'
//     const formattedNextActions = nextActions
//       .filter(
//         (a: { action: string; target: string; pic: string }) =>
//           a.action?.trim() || a.target?.trim() || a.pic?.trim()
//       )
//       .map((a: { action: string; target: string; pic: string }) => ({
//         action: a.action,
//         target: a.target,
//         pic: a.pic,
//       }));
//     // --- AKHIR PERBAIKAN ---


//     // 3. Dapatkan data progress yang ada
//     const existingMom = await prisma.mom.findUnique({ 
//         where: { id: momId }, 
//         select: { progress_id: true } 
//     });
    
//     let newProgressId = existingMom?.progress_id;

//     // Logika update/create progress_id
//     if (is_finish === 1) {
//         if (existingMom?.progress_id) {
//             await prisma.progress.update({
//                 where: { id: existingMom.progress_id },
//                 data: { status_id: 1 } // Asumsi 1 = Selesai
//             });
//         } else {
//             const newProgress = await prisma.progress.create({
//                 data: {
//                     company_id: Number(companyId),
//                     step_id: 1, // step MOM
//                     status_id: 1, // Selesai
//                 }
//             });
//             newProgressId = newProgress.id;
//         }
//     } else {
//         if (existingMom?.progress_id) {
//              await prisma.progress.update({
//                 where: { id: existingMom.progress_id },
//                 data: { status_id: null } // Draft
//             });
//         }
//         // Jika is_finish = 0 dan progress_id null, kita biarkan (atau buat progress baru dgn status null)
//     }

//     // 4. Update data MOM
//     const updatedMom = await prisma.mom.update({
//       where: { id: momId },
//       data: {
//         company_id: Number(companyId),
//         title: judul || "",
//         date: new Date(tanggalMom),
//         time: waktu || "",
//         venue: venue || "",
//         count_attendees: peserta || "",
//         content: content || [],
//         progress_id: newProgressId,

//         // Buat ulang relasi
//         approvers: {
//           create: formattedApprovers,
//         },
//         next_actions: {
//           create: formattedNextActions, // <-- Gunakan data yang sudah diformat
//         },
//         // (Logika update attachments)
//       },
//       include: {
//         approvers: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     return NextResponse.json({ message: "MOM berhasil di-update", data: updatedMom });
//   } catch (error: any) {
//     console.error("Gagal meng-update MOM:", error);
//     if (error.name === 'PrismaClientValidationError') {
//          console.error("Kesalahan Validasi Prisma:", error.message);
//          return NextResponse.json({ error: "Kesalahan Validasi Data.", details: error.message }, { status: 400 });
//     }
//     return NextResponse.json(
//       { error: "Gagal meng-update MOM", details: error.message },
//       { status: 500 }
//     );
//   }
// }

// import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma/postgres";

// // FUNGSI: GET (Untuk mengambil 1 MOM berdasarkan ID)
// export async function GET(
//   req: Request,
//   { params }: { params: { id: string } }
// ) {
//   try {
//     const momId = parseInt(params.id, 10);
//     if (isNaN(momId)) {
//       return NextResponse.json({ error: "ID MOM tidak valid" }, { status: 400 });
//     }

//     const mom = await prisma.mom.findUnique({
//       where: { id: momId },
//       include: {
//         company: true,
//         approvers: true,
//         next_actions: true,
//         attachments: {
//           include: {
//             files: true,
//           },
//         },
//       },
//     });

//     if (!mom) {
//       return NextResponse.json({ error: "MOM tidak ditemukan" }, { status: 404 });
//     }

//     return NextResponse.json(mom);
//   } catch (error: any) {
//     console.error("Gagal mengambil MOM:", error);
//     return NextResponse.json(
//       { error: "Gagal mengambil data MOM", details: error.message },
//       { status: 500 }
//     );
//   }
// }

// // FUNGSI: PUT (Untuk meng-update 1 MOM berdasarkan ID)
// export async function PUT(
//   req: Request,
//   { params }: { params: { id: string } }
// ) {
//   try {
//     const momId = parseInt(params.id, 10);
//     if (isNaN(momId)) {
//       return NextResponse.json({ error: "ID MOM tidak valid" }, { status: 400 });
//     }

//     const body = await req.json();
//     const {
//       companyId,
//       judul,
//       tanggalMom,
//       peserta,
//       venue,
//       waktu,
//       content,
//       approvers,
//       attachments,
//       nextActions,
//       is_finish,
//     } = body;

//     // 1. Hapus data relasional lama (simple approach)
//     // Pendekatan yang lebih kompleks akan membandingkan mana yang dihapus/diubah
//     await prisma.approver.deleteMany({ where: { mom_id: momId } });
//     await prisma.nextAction.deleteMany({ where: { mom_id: momId } });
//     // Menghapus attachments lebih rumit karena harus menghapus files-nya dulu
//     // Untuk saat ini, kita akan fokus pada approvers dan next_actions

//     // 2. Format data baru
//     const formattedApprovers = approvers.map(
//       (a: { name: string; email: string; type: string }) => ({
//         name: a.name,
//         email: a.email,
//         type: a.type,
//       })
//     );
    
//     // (Anda mungkin perlu logika update/delete attachment di sini)

//     // 3. Update data MOM
//     const updatedMom = await prisma.mom.update({
//       where: { id: momId },
//       data: {
//         company_id: Number(companyId),
//         title: judul || "",
//         date: new Date(tanggalMom),
//         time: waktu || "",
//         venue: venue || "",
//         count_attendees: peserta || "",
//         content: content || [],
        
//         // Update progress_id jika 'is_finish' dikirim
//         progress_id: is_finish === 1 ? 2 : 1, // Asumsi 2 = Selesai, 1 = Draft

//         // Buat ulang relasi
//         approvers: {
//           create: formattedApprovers,
//         },
//         next_actions: {
//           create: nextActions,
//         },
//         // (Logika update attachments)
//       },
//       include: {
//         approvers: true,
//         attachments: { include: { files: true } },
//         next_actions: true,
//       },
//     });

//     return NextResponse.json({ message: "MOM berhasil di-update", data: updatedMom });
//   } catch (error: any) {
//     console.error("Gagal meng-update MOM:", error);
//     return NextResponse.json(
//       { error: "Gagal meng-update MOM", details: error.message },
//       { status: 500 }
//     );
//   }
// }