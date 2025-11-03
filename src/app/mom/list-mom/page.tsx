"use client";

import { DataTable } from "@/components/layout/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { saveAs } from "file-saver"; // 1. Import saveAs

export default function ListMomPage() {
  const router = useRouter();
  const [moms, setMoms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  // 2. State untuk melacak loading per baris
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // 3. Buat fungsi fetch yang bisa dipakai ulang
  const fetchMoms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mom");
      if (!res.ok) throw new Error("Gagal mengambil data MOM");
      const data = await res.json();
      
      const formatted = data.map((mom: any) => ({
        ...mom,
        date: new Date(mom.date).toLocaleDateString("id-ID", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        }),
      }));
      setMoms(formatted);
    } catch (err) {
      console.error(err);
      alert("Gagal memuat MOM");
    } finally {
      setLoading(false);
    }
  }, []);

  // Panggil fetchMoms saat komponen dimuat
  useEffect(() => {
    fetchMoms();
  }, [fetchMoms]);

  const columns = [
    { key: "company.name", label: "Nama Perusahaan" },
    { key: "title", label: "Judul MOM" },
    { key: "date", label: "Tanggal MOM" },
    { key: "venue", label: "Tempat Dilaksanakan" },
  ];

  const filteredMoms = useMemo(() => {
    return moms.filter(
      (c) =>
        c.company?.name.toLowerCase().includes(filter.toLowerCase()) ||
        c.title.toLowerCase().includes(filter.toLowerCase())
    );
  }, [moms, filter]);

  // 4. Implementasi Logika Generate Docs
  const handleGenerateDocs = async (row: any) => {
    setGeneratingId(row.id);
    try {
      const response = await fetch('/api/mom/generate-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ momId: row.id }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Gagal generate DOCX');
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition');
      let fileName = `MOM_${row.id}.docx`;
      if (contentDisposition) {
        const fileNameMatch = contentDisposition.match(/filename="?(.+)"?/i);
        if (fileNameMatch && fileNameMatch.length > 1) {
          fileName = fileNameMatch[1].replace(/"$/, '');
        }
      }
      saveAs(blob, fileName);
    } catch (error: any) {
      console.error(error);
      alert("Error: " + error.message);
    } finally {
      setGeneratingId(null);
    }
  };

  // 5. Implementasi Logika Edit
  const handleEdit = (row: any) => {
    router.push(`/mom/edit/${row.id}`);
  };

  // 6. Implementasi Logika Delete
  const handleDelete = async (row: any) => {
    if (window.confirm(`Apakah Anda yakin ingin menghapus MOM: ${row.title}?`)) {
      setDeletingId(row.id);
      try {
        const response = await fetch(`/api/mom/${row.id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Gagal menghapus MOM');
        }

        alert("MOM berhasil dihapus.");
        // Muat ulang data setelah berhasil hapus
        fetchMoms(); 
      } catch (error: any) {
        console.error("Error deleting MOM:", error);
        alert("Error: " + error.message);
      } finally {
        setDeletingId(null);
      }
    }
  };

  return (
    <div className="p-6">
      <Card className="shadow-md bg-white rounded-2xl">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-2xl font-bold">MOM List</CardTitle>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari perusahaan..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-8"
              />
            </div>
            {/* <CreatseCompanyModal /> */}
          </div>
        </CardHeader>

        <CardContent>
          {loading && moms.length === 0 ? ( // Tampilkan loading hanya jika data belum ada
            <div className="flex items-center justify-center py-10">
              <Loader2 className="animate-spin mr-2 h-5 w-5" />
              <span>Loading data...</span>
            </div>
          ) : (
            // 7. Teruskan state loading ke DataTable
            <DataTable
              columns={columns}
              data={filteredMoms}
              type="mom"
              onView={handleGenerateDocs}
              onEdit={handleEdit}
              onDelete={handleDelete}
              generatingId={generatingId}
              deletingId={deletingId}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// "use client";

// import { DataTable } from "@/components/layout/data-table";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Input } from "@/components/ui/input";
// import { Loader2, Search } from "lucide-react";
// import { useEffect, useMemo, useState } from "react";
// import { useRouter } from "next/navigation"; // ✅ 1. Import router

// export default function ListMomPage() {
//   const router = useRouter(); // ✅ 2. Inisialisasi router
//   const [moms, setMoms] = useState<any[]>([]);
//   const [loading, setLoading] = useState(true);
//   const [filter, setFilter] = useState("");

//   useEffect(() => {
//     fetch("/api/mom")
//       .then((res) => res.json())
//       .then((data) => {
//         const formatted = data.map((mom: any) => ({
//           ...mom,
//           date: new Date(mom.date).toLocaleDateString("id-ID", {
//             day: "2-digit",
//             month: "long",
//             year: "numeric",
//           }),
//         }));
//         setMoms(formatted);
//         setLoading(false);
//       })
//       .catch(() => setLoading(false));
//   }, []);

//   const columns = [
//     { key: "company.name", label: "Nama Perusahaan" },
//     { key: "title", label: "Judul MOM" },
//     { key: "date", label: "Tanggal MOM" },
//     { key: "venue", label: "Tempat Dilaksanakan" },
//   ];

//   const filteredMoms = useMemo(() => {
//     return moms.filter(
//       (c) =>
//         c.company?.name.toLowerCase().includes(filter.toLowerCase()) ||
//         c.title.toLowerCase().includes(filter.toLowerCase())
//     );
//   }, [moms, filter]);

//   // ✅ 3. Definisikan handler untuk actions
//   const handleGenerateDocs = (row: any) => {
//     alert(`Fungsi Generate Docs untuk: ${row.title}`);
//     // Anda bisa tambahkan logic fetch ke /api/mom/generate-docx di sini
//     console.log("Generate Docs:", row);
//   };

//   const handleEdit = (row: any) => {
//     // Arahkan ke halaman edit dengan ID
//     router.push(`/mom/edit/${row.id}`);
//   };

//   const handleDelete = async (row: any) => {
//     if (window.confirm(`Apakah Anda yakin ingin menghapus MOM: ${row.title}?`)) {
//       try {
//         const response = await fetch(`/api/mom/${row.id}`, {
//           method: "DELETE",
//         });

//         if (response.ok) {
//           // Jika berhasil, update state moms untuk menghapus item
//           setMoms((prevMoms) => prevMoms.filter((mom) => mom.id !== row.id));
//           alert("MOM berhasil dihapus.");
//         } else {
//           alert("Gagal menghapus MOM.");
//         }
//       } catch (error) {
//         console.error("Error deleting MOM:", error);
//         alert("Terjadi kesalahan saat menghapus.");
//       }
//     }
//   };

//   return (
//     <div className="p-6">
//       <Card className="shadow-md bg-white rounded-2xl">
//         <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
//           <CardTitle className="text-2xl font-bold">MOM List</CardTitle>

//           <div className="flex items-center gap-3 w-full sm:w-auto">
//             <div className="relative w-full sm:w-64">
//               <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
//               <Input
//                 placeholder="Cari perusahaan..."
//                 value={filter}
//                 onChange={(e) => setFilter(e.target.value)}
//                 className="pl-8"
//               />
//             </div>
//             {/* <CreatseCompanyModal /> */}
//           </div>
//         </CardHeader>

//         <CardContent>
//           {loading ? (
//             <div className="flex items-center justify-center py-10">
//               <Loader2 className="animate-spin mr-2 h-5 w-5" />
//               <span>Loading data...</span>
//             </div>
//           ) : (
//             // ✅ 4. Teruskan handler ke DataTable
//             <DataTable
//               columns={columns}
//               data={filteredMoms}
//               type="mom"
//               onView={handleGenerateDocs} // onView akan memicu "Generate Docs"
//               onEdit={handleEdit}
//               onDelete={handleDelete}
//             />
//           )}
//         </CardContent>
//       </Card>
//     </div>
//   );
// }

// "use client";

// import { useEffect, useState } from "react";
// import { Button } from "@/components/ui/button";
// import Link from "next/link";
// import {
//   Table,
//   TableBody,
//   TableCell,
//   TableHead,
//   TableHeader,
//   TableRow,
// } from "@/components/ui/table";
// // Progress bar dihapus
// import { saveAs } from "file-saver";
// import { Pencil, Trash2, Loader2 } from "lucide-react"; // Ditambahkan Trash2
// import {
//   Tooltip,
//   TooltipContent,
//   TooltipProvider,
//   TooltipTrigger,
// } from "@/components/ui/tooltip";

// interface Mom {
//   id: number;
//   title: string;
//   date: string;
//   company: { name: string };
//   progress: {
//     id: number;
//     step: { name: string };
//     status: { name: string } | null;
//   };
//   created_at: string;
// }

// export default function ListMomPage() {
//   const [moms, setMoms] = useState<Mom[]>([]);
//   const [loading, setLoading] = useState(true);
//   const [generatingDocx, setGeneratingDocx] = useState<number | null>(null);
//   const [deletingId, setDeletingId] = useState<number | null>(null); // State baru untuk delete

//   async function fetchMoms() {
//     setLoading(true);
//     try {
//       const res = await fetch("/api/mom");
//       if (!res.ok) throw new Error("Gagal mengambil data MOM");
//       const data = await res.json();
//       setMoms(data);
//     } catch (err) {
//       console.error(err);
//       alert("Gagal memuat MOM");
//     } finally {
//       setLoading(false);
//     }
//   }

//   useEffect(() => {
//     fetchMoms();
//   }, []);

//   async function handleGenerateDocx(momId: number) {
//     setGeneratingDocx(momId);
//     try {
//       const response = await fetch('/api/mom/generate-docx', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ momId: momId }),
//       });

//       if (!response.ok) {
//         const errorData = await response.json();
//         throw new Error(errorData.error || 'Gagal generate DOCX');
//       }

//       const blob = await response.blob();
//       const contentDisposition = response.headers.get('content-disposition');
//       let fileName = `MOM_${momId}.docx`;
//       if (contentDisposition) {
//         const fileNameMatch = contentDisposition.match(/filename="?(.+)"?/i);
//         if (fileNameMatch && fileNameMatch.length > 1) {
//           fileName = fileNameMatch[1].replace(/"$/, '');
//         }
//       }
      
//       saveAs(blob, fileName);
//     } catch (error: any) {
//       console.error(error);
//       alert("Error: " + error.message);
//     } finally {
//       setGeneratingDocx(null);
//     }
//   }

//   // Fungsi baru untuk delete
//   async function handleDeleteMom(momId: number) {
//     if (!confirm("Apakah Anda yakin ingin menghapus MOM ini?")) {
//       return;
//     }

//     setDeletingId(momId);
//     try {
//       const response = await fetch(`/api/mom/${momId}`, {
//         method: 'DELETE',
//       });

//       if (!response.ok) {
//         const errorData = await response.json();
//         throw new Error(errorData.error || 'Gagal menghapus MOM');
//       }

//       alert("MOM berhasil dihapus");
//       // Muat ulang daftar MOM setelah dihapus
//       fetchMoms(); 
//     } catch (error: any) {
//       console.error(error);
//       alert("Error: " + error.message);
//     } finally {
//       setDeletingId(null);
//     }
//   }

//   if (loading) {
//     return <div className="container mx-auto py-8 px-4 max-w-6xl">Loading...</div>;
//   }

//   return (
//     <div className="container mx-auto py-8 px-4 max-w-6xl">
//       <div className="flex justify-between items-center mb-6">
//         <h1 className="text-3xl font-bold">List Minutes of Meeting</h1>
//         <Button asChild>
//           <Link href="/mom/create">Buat MOM Baru</Link>
//         </Button>
//       </div>

//       <div className="bg-white rounded-2xl shadow p-6">
//         <Table>
//           <TableHeader>
//             <TableRow>
//               <TableHead>Judul</TableHead>
//               <TableHead>Mitra</TableHead>
//               <TableHead>Tanggal</TableHead>
//               <TableHead>Status</TableHead>
//               <TableHead className="text-right">Action</TableHead>
//             </TableRow>
//           </TableHeader>
//           <TableBody>
//             {moms.map((mom) => (
//               <TableRow key={mom.id}>
//                 <TableCell className="font-medium">{mom.title}</TableCell>
//                 <TableCell>{mom.company?.name || '-'}</TableCell>
//                 <TableCell>{new Date(mom.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</TableCell>
//                 <TableCell>
//                   {/* Progress bar dihapus, hanya teks status */}
//                   <div>{mom.progress?.step?.name || 'Draft'}</div>
//                 </TableCell>
//                 <TableCell className="flex gap-2 items-center justify-end">
//                   <Button
//                     variant="outline"
//                     size="sm"
//                     onClick={() => handleGenerateDocx(mom.id)}
//                     disabled={generatingDocx === mom.id || deletingId === mom.id}
//                   >
//                     {generatingDocx === mom.id ? 'Generating...' : 'Generate DOCX'}
//                   </Button>
                  
//                   <TooltipProvider>
//                     <Tooltip>
//                       <TooltipTrigger asChild>
//                         <Button variant="outline" size="icon" asChild>
//                           <Link href={`/mom/edit/${mom.id}`}>
//                             <Pencil className="h-4 w-4" />
//                           </Link>
//                         </Button>
//                       </TooltipTrigger>
//                       <TooltipContent>
//                         <p>Edit MOM</p>
//                       </TooltipContent>
//                     </Tooltip>
//                   </TooltipProvider>

//                   {/* Tombol Delete Baru */}
//                   <TooltipProvider>
//                     <Tooltip>
//                       <TooltipTrigger asChild>
//                         <Button
//                           variant="outline"
//                           size="icon"
//                           onClick={() => handleDeleteMom(mom.id)}
//                           disabled={generatingDocx === mom.id || deletingId === mom.id}
//                           className="text-red-600 hover:text-red-700 hover:bg-red-50"
//                         >
//                           {deletingId === mom.id ? (
//                             <Loader2 className="h-4 w-4 animate-spin" />
//                           ) : (
//                             <Trash2 className="h-4 w-4" />
//                           )}
//                         </Button>
//                       </TooltipTrigger>
//                       <TooltipContent>
//                         <p>Hapus MOM</p>
//                       </TooltipContent>
//                     </Tooltip>
//                   </TooltipProvider>

//                 </TableCell>
//               </TableRow>
//             ))}
//           </TableBody>
//         </Table>
//       </div>
//     </div>
//   );
// }

// "use client";

// import { useEffect, useState } from "react";
// import { Button } from "@/components/ui/button";
// import Link from "next/link";
// import {
//   Table,
//   TableBody,
//   TableCell,
//   TableHead,
//   TableHeader,
//   TableRow,
// } from "@/components/ui/table";
// import { Progress } from "@/components/ui/progress";
// import { saveAs } from "file-saver";
// import { Pencil } from "lucide-react";
// import {
//   Tooltip,
//   TooltipContent,
//   TooltipProvider,
//   TooltipTrigger,
// } from "@/components/ui/tooltip";

// interface Mom {
//   id: number;
//   title: string;
//   date: string;
//   company: { name: string };
//   progress: {
//     id: number;
//     step: { name: string };
//     status: { name: string } | null;
//   };
//   created_at: string;
// }

// export default function ListMomPage() {
//   const [moms, setMoms] = useState<Mom[]>([]);
//   const [loading, setLoading] = useState(true);
//   const [generatingDocx, setGeneratingDocx] = useState<number | null>(null);

//   async function fetchMoms() {
//     setLoading(true);
//     try {
//       const res = await fetch("/api/mom");
//       if (!res.ok) throw new Error("Gagal mengambil data MOM");
//       const data = await res.json();
//       setMoms(data);
//     } catch (err) {
//       console.error(err);
//       alert("Gagal memuat MOM");
//     } finally {
//       setLoading(false);
//     }
//   }

//   useEffect(() => {
//     fetchMoms();
//   }, []);

//   async function handleGenerateDocx(momId: number) {
//     setGeneratingDocx(momId);
//     try {
//       const response = await fetch('/api/mom/generate-docx', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ momId: momId }),
//       });

//       if (!response.ok) {
//         const errorData = await response.json();
//         throw new Error(errorData.error || 'Gagal generate DOCX');
//       }

//       const blob = await response.blob();
//       const contentDisposition = response.headers.get('content-disposition');
//       let fileName = `MOM_${momId}.docx`;
//       if (contentDisposition) {
//         const fileNameMatch = contentDisposition.match(/filename="?(.+)"?/i);
//         if (fileNameMatch && fileNameMatch.length > 1) {
//           fileName = fileNameMatch[1].replace(/"$/, '');
//         }
//       }
      
//       saveAs(blob, fileName);
//     } catch (error: any) {
//       console.error(error);
//       alert("Error: " + error.message);
//     } finally {
//       setGeneratingDocx(null);
//     }
//   }

//   if (loading) {
//     return <div className="container mx-auto py-8 px-4 max-w-6xl">Loading...</div>;
//   }

//   return (
//     <div className="container mx-auto py-8 px-4 max-w-6xl">
//       <div className="flex justify-between items-center mb-6">
//         <h1 className="text-3xl font-bold">List Minutes of Meeting</h1>
//         <Button asChild>
//           <Link href="/mom/create">Buat MOM Baru</Link>
//         </Button>
//       </div>

//       <div className="bg-white rounded-2xl shadow p-6">
//         <Table>
//           <TableHeader>
//             <TableRow>
//               <TableHead>Judul</TableHead>
//               <TableHead>Mitra</TableHead>
//               <TableHead>Tanggal</TableHead>
//               <TableHead>Status</TableHead>
//               <TableHead>Action</TableHead>
//             </TableRow>
//           </TableHeader>
//           <TableBody>
//             {moms.map((mom) => (
//               <TableRow key={mom.id}>
//                 <TableCell className="font-medium">{mom.title}</TableCell>
//                 <TableCell>{mom.company?.name || '-'}</TableCell>
//                 <TableCell>{new Date(mom.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</TableCell>
//                 <TableCell>
//                   <div>{mom.progress?.step?.name || 'Draft'}</div>
//                   <Progress value={mom.progress?.status?.name === 'Completed' ? 100 : 50} className="w-[60%]" />
//                 </TableCell>
//                 <TableCell className="flex gap-2 items-center">
//                   <Button
//                     variant="outline"
//                     size="sm"
//                     onClick={() => handleGenerateDocx(mom.id)}
//                     disabled={generatingDocx === mom.id}
//                   >
//                     {generatingDocx === mom.id ? 'Generating...' : 'Generate DOCX'}
//                   </Button>
                  
//                   <TooltipProvider>
//                     <Tooltip>
//                       <TooltipTrigger asChild>
//                         <Button variant="outline" size="icon" asChild>
//                           <Link href={`/mom/edit/${mom.id}`}>
//                             <Pencil className="h-4 w-4" />
//                           </Link>
//                         </Button>
//                       </TooltipTrigger>
//                       <TooltipContent>
//                         <p>Edit MOM</p>
//                       </TooltipContent>
//                     </Tooltip>
//                   </TooltipProvider>

//                 </TableCell>
//               </TableRow>
//             ))}
//           </TableBody>
//         </Table>
//       </div>
//     </div>
//   );
// }

// "use client";

// import { DataTable } from "@/components/layout/data-table";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Input } from "@/components/ui/input";
// import { Loader2, Search } from "lucide-react";
// import { useEffect, useMemo, useState } from "react";

// export default function ListMomPage() {

//   const [moms, setMoms] = useState<any[]>([]);
//   const [loading, setLoading] = useState(true);
//   const [filter, setFilter] = useState("");

//   useEffect(() => {
//     fetch("/api/mom")
//       .then((res) => res.json())
//       .then((data) => {
//           const formatted = data.map((mom: any) => ({
//           ...mom,
//           date: new Date(mom.date).toLocaleDateString("id-ID", {
//             day: "2-digit",
//             month: "long",
//             year: "numeric",
//           }),
//         }));
//         setMoms(formatted);
//         setLoading(false);
//       })
//       .catch(() => setLoading(false));
//   }, []);

//   const columns = [
//     { key: "company.name", label: "Nama Perusahaan" },
//     { key: "title", label: "Judul MOM" },
//     { key: "date", label: "Tanggal MOM" },
//     { key: "venue", label: "Tempat Dilaksanakan" },
//   ];

//   // 🔍 Filter data secara real-time
//   const filteredMoms = useMemo(() => {
//     return moms.filter((c) =>
//       c.company?.name.toLowerCase().includes(filter.toLowerCase())
//     );
//   }, [moms, filter]);

//   return (
//     <div className="p-6">
//       <Card className="shadow-md bg-white rounded-2xl">
//         <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
//           <CardTitle className="text-2xl font-bold">MOM List</CardTitle>

//           <div className="flex items-center gap-3 w-full sm:w-auto">
//             <div className="relative w-full sm:w-64">
//               <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
//               <Input
//                 placeholder="Cari perusahaan..."
//                 value={filter}
//                 onChange={(e) => setFilter(e.target.value)}
//                 className="pl-8"
//               />
//             </div>
//             {/* <CreatseCompanyModal /> */}
//           </div>
//         </CardHeader>

//         <CardContent>
//           {loading ? (
//             <div className="flex items-center justify-center py-10">
//               <Loader2 className="animate-spin mr-2 h-5 w-5" />
//               <span>Loading data...</span>
//             </div>
//           ) : (
//             <DataTable columns={columns} data={filteredMoms} type="mom" />
//           )}
//         </CardContent>
//       </Card>
//     </div>
//   );
// }