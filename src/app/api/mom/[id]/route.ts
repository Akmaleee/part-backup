import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/postgres";

// FUNGSI: GET (Untuk mengambil 1 MOM berdasarkan ID)
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const momId = parseInt(params.id, 10);
    if (isNaN(momId)) {
      return NextResponse.json({ error: "ID MOM tidak valid" }, { status: 400 });
    }

    const mom = await prisma.mom.findUnique({
      where: { id: momId },
      include: {
        company: true,
        approvers: true,
        next_actions: true,
        attachments: { // Ini adalah relasi 'attachments' di model 'Mom'
          include: {
            files: true, // Ini adalah relasi 'files' di model 'MomAttachmentSection'
          },
        },
      },
    });

    if (!mom) {
      return NextResponse.json({ error: "MOM tidak ditemukan" }, { status: 404 });
    }

    return NextResponse.json(mom);
  } catch (error: any) {
    console.error("Gagal mengambil MOM:", error);
    return NextResponse.json(
      { error: "Gagal mengambil data MOM", details: error.message },
      { status: 500 }
    );
  }
}

// FUNGSI: PUT (Untuk meng-update 1 MOM berdasarkan ID)
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const momId = parseInt(params.id, 10);
    if (isNaN(momId)) {
      return NextResponse.json({ error: "ID MOM tidak valid" }, { status: 400 });
    }

    const body = await req.json();
    const {
      companyId,
      judul,
      tanggalMom,
      peserta,
      venue,
      waktu,
      content,
      approvers,
      attachments,
      nextActions,
      is_finish,
    } = body;

    // 1. Hapus data relasional lama
    await prisma.approver.deleteMany({ where: { mom_id: momId } });
    await prisma.nextAction.deleteMany({ where: { mom_id: momId } });
    
    // (Logika update/delete attachment lebih kompleks, kita abaikan dulu)
    // Jika Anda ingin mengupdate attachment, Anda perlu:
    // 1. Mengambil attachment sections yang ada.
    // 2. Membandingkan dengan 'attachments' dari body.
    // 3. Menghapus files/sections yang tidak ada di body.
    // 4. Membuat yang baru.

    // 2. Format data baru
    const formattedApprovers = approvers.map(
      (a: { name: string; email: string; type: string }) => ({
        name: a.name,
        email: a.email,
        type: a.type,
      })
    );

    const formattedNextActions = nextActions
      .filter(
        (a: { action: string; target: string; pic: string }) =>
          a.action?.trim() || a.target?.trim() || a.pic?.trim()
      )
      .map((a: { action: string; target: string; pic: string }) => ({
        action: a.action,
        target: a.target,
        pic: a.pic,
      }));

    // 3. Dapatkan data progress yang ada
    const existingMom = await prisma.mom.findUnique({ 
        where: { id: momId }, 
        select: { progress_id: true } 
    });
    
    let newProgressId = existingMom?.progress_id;

    // Logika update/create progress_id
    if (is_finish === 1) {
        if (existingMom?.progress_id) {
            await prisma.progress.update({
                where: { id: existingMom.progress_id },
                data: { status_id: 1 } // Asumsi 1 = Selesai
            });
        } else {
            const newProgress = await prisma.progress.create({
                data: {
                    company_id: Number(companyId),
                    step_id: 1, // step MOM
                    status_id: 1, // Selesai
                }
            });
            newProgressId = newProgress.id;
        }
    } else {
        if (existingMom?.progress_id) {
             await prisma.progress.update({
                where: { id: existingMom.progress_id },
                data: { status_id: null } // Draft
            });
        }
    }

    // 4. Update data MOM
    const updatedMom = await prisma.mom.update({
      where: { id: momId },
      data: {
        company_id: Number(companyId),
        title: judul || "",
        date: new Date(tanggalMom),
        time: waktu || "",
        venue: venue || "",
        count_attendees: peserta || "",
        content: content || [],
        progress_id: newProgressId,

        approvers: {
          create: formattedApprovers,
        },
        next_actions: {
          create: formattedNextActions, 
        },
      },
      include: {
        approvers: true,
        attachments: { include: { files: true } },
        next_actions: true,
      },
    });

    return NextResponse.json({ message: "MOM berhasil di-update", data: updatedMom });
  } catch (error: any) {
    console.error("Gagal meng-update MOM:", error);
    if (error.name === 'PrismaClientValidationError') {
         console.error("Kesalahan Validasi Prisma:", error.message);
         return NextResponse.json({ error: "Kesalahan Validasi Data.", details: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Gagal meng-update MOM", details: error.message },
      { status: 500 }
    );
  }
}

// --- [PERBAIKAN FUNGSI DELETE] ---
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const momId = parseInt(params.id, 10);
    if (isNaN(momId)) {
      return NextResponse.json({ error: "ID MOM tidak valid" }, { status: 400 });
    }

    // 1. Ambil data MOM (termasuk progress_id-nya)
    const mom = await prisma.mom.findUnique({ 
      where: { id: momId }, 
      select: { progress_id: true } 
    });

    if (!mom) {
      return NextResponse.json({ error: "MOM tidak ditemukan untuk dihapus" }, { status: 404 });
    }

    // 2. Hapus relasi anak (1-ke-N)
    await prisma.approver.deleteMany({ where: { mom_id: momId } });
    await prisma.nextAction.deleteMany({ where: { mom_id: momId } });

    // 3. Hapus relasi lampiran (Berjenjang)
    
    // 3a. Cari semua 'Section' yang terkait dengan MOM ini
    const sections = await prisma.momAttachmentSection.findMany({
      where: { mom_id: momId },
      select: { id: true }
    });
    const sectionIds = sections.map(s => s.id);

    // 3b. Hapus semua 'Files' yang terkait dengan 'Sections' tersebut
    if (sectionIds.length > 0) {
      await prisma.momAttachmentFile.deleteMany({
        where: { section_id: { in: sectionIds } } // Hapus berdasarkan 'section_id'
      });
    }

    // 3c. Hapus 'Sections' itu sendiri (Menggunakan nama model yang benar)
    await prisma.momAttachmentSection.deleteMany({
      where: { mom_id: momId }
    });

    // 4. Hapus MOM utama
    await prisma.mom.delete({
      where: { id: momId },
    });

    // 5. (Opsional) Hapus 'Progress'
    if (mom.progress_id) {
      try {
        await prisma.progress.delete({ where: { id: mom.progress_id } });
      } catch (progressError) {
        console.warn(`Gagal menghapus progress record ${mom.progress_id}:`, progressError);
      }
    }

    return NextResponse.json({ message: "MOM berhasil dihapus" }, { status: 200 });

  } catch (error: any) {
    console.error("Gagal menghapus MOM:", error);
    if (error.code === 'P2025') { 
        return NextResponse.json({ error: "Gagal menghapus relasi, data tidak ditemukan" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Gagal menghapus MOM", details: error.message },
      { status: 500 }
    );
  }
}

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