// src/app/mom/create/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { DurationTimeInput, InputString } from "@/components/input";
import { CreateCompanyModal } from "@/components/company/create-modal";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import InputSelect from "@/components/input/input-select";
import RichTextInput from "@/components/input/rich-text-input";
import ContentDocument, { MomContentSection } from "./content-document";
import type { JSONContent } from "@tiptap/react";
import DetailDocument from "./detail-document";
import NextActionDocument from "./next-action-document";
import { ApproverDocument } from "./approver-document";
import AttachmentDocument from "@/app/mom/create/attachment-document";

export interface MomForm {
  companyId: string;
  judul: string;
  tanggalMom: string;
  peserta: string;
  venue: string;
  waktu: string;
  content: MomContentSection[];
  approvers: {name: string}[];
  attachments: { sectionName: string, files: File[] }[];
  nextActions: { action: string; target: string; pic: string }[];
}

interface Company {
  id: string;
  name: string;
}

export default function CreateMomPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState<MomForm>({
    companyId: "",
    judul: "",
    tanggalMom: "",
    peserta: "",
    venue: "",
    waktu: "",
    content: [],
    approvers: [{ name: "" }],
    attachments: [{ sectionName: "", files: []  }],
    nextActions: [{ action: "", target: "", pic: "" }],
  });

  const [generatedMomId, setGeneratedMomId] = useState<string | null>(null);
  const [isGeneratingDocx, setIsGeneratingDocx] = useState(false);
  
  const handleContentChange = useCallback((sections: MomContentSection[]) => {
    setForm((prev) => ({ ...prev, content: sections }));
  }, []);

  // UBAH DI SINI: Ubah definisi fungsi agar sesuai dengan props anak
  function handleChange(field: string, value: any) {
    setForm((prev) => ({ ...prev, [field as keyof MomForm]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGeneratedMomId(null); 

    const submitter = (e.nativeEvent as any).submitter;
    const isFinish = submitter?.name === "finish" ? 1 : 0;

    const required = ["companyId", "judul", "tanggalMom", "peserta", "venue", "waktu"];
    for (const field of required) {
      const value = form[field as keyof MomForm];

      if (typeof value === "string" && value.trim() === "") {
        alert(`Field ${field} wajib diisi.`);
        return;
      }
      if (value === null || value === undefined) {
        alert(`Field ${field} wajib diisi.`);
        return;
      }
    }

    const uploadedAttachments = await Promise.all(
      form.attachments.map(async (section) => {
        const isFileArray = Array.isArray(section.files) && section.files.some(f => f instanceof File);
        if (!isFileArray) {
          return {
            sectionName: section.sectionName,
            files: section.files || [],
          };
        }

        const formData = new FormData();
        section.files.forEach((file) => {
          if (file instanceof File) formData.append("files", file);
        });

        const res = await fetch("/api/uploads/attachment", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) throw new Error("Gagal upload file di section " + section.sectionName);
        const uploaded = await res.json();
        const filesArray = Array.isArray(uploaded) ? uploaded : [uploaded];

        return {
          sectionName: section.sectionName,
          files: filesArray,
        };
      })
    );

    const formatted = form.content.map((s: any) => ({
      label: s.label,
      content: s.content || "",
    }));

    const payload = {
      ...form,
      attachments: uploadedAttachments,
      content: formatted,
      nextActions: form.nextActions.filter(
        (a) => a.action.trim() || a.target.trim() || a.pic.trim()
      ),
      is_finish: isFinish,
    };

    setLoading(true);
    try {
      const res = await fetch("/api/mom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Gagal create MOM");
      }

      const data = await res.json();
      alert("MOM berhasil disimpan!");
      setGeneratedMomId(data?.data?.id); 
    } catch (err: any) {
      console.error(err);
      alert("Gagal menyimpan MOM: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateDocx() {
    if (!generatedMomId) {
      alert("Silakan simpan MOM terlebih dahulu.");
      return;
    }
    setIsGeneratingDocx(true);
    try {
      const response = await fetch('/api/mom/generate-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ momId: generatedMomId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Gagal men-generate dokumen DOCX');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      
      const contentDisposition = response.headers.get('content-disposition');
      let fileName = `MOM_${generatedMomId}.docx`;
      if (contentDisposition) {
          const fileNameMatch = contentDisposition.match(/filename="?(.+)"?/i);
          if (fileNameMatch && fileNameMatch.length > 1) {
              fileName = fileNameMatch[1].replace(/"$/, '');
          }
      }
      
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

    } catch (error: any) {
      console.error(error);
      alert("Error generating DOCX: " + error.message);
    } finally {
      setIsGeneratingDocx(false);
    }
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <form onSubmit={handleSubmit}>
        {/* Error L207 dan L209 akan hilang */}
        <DetailDocument form={form} setForm={setForm} handleChange={handleChange} /> 
        <ContentDocument onChange={handleContentChange}/>
        <NextActionDocument form={form} setForm={setForm} handleChange={handleChange} />
        <ApproverDocument form={form} handleChange={handleChange} />
        <AttachmentDocument sections={form.attachments} handleChange={handleChange} />

        <div className="w-full bg-white rounded-2xl shadow p-6">
          <div className="flex gap-4 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" name="save" disabled={loading || isGeneratingDocx}>
              {loading ? "Saving..." : "Save"}
            </Button>
            <Button type="submit" name="finish" disabled={loading || isGeneratingDocx}>
              {loading ? "Saving..." : "Save & Finish"}
            </Button>
            {generatedMomId && (
                <Button
                    type="button"
                    onClick={handleGenerateDocx}
                    disabled={isGeneratingDocx || loading}
                    variant="outline"
                >
                    {isGeneratingDocx ? "Generating DOCX..." : "Generate DOCX"}
                </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
// "use client";

// import { useState, useEffect, useCallback } from "react";
// import { DurationTimeInput, InputString } from "@/components/input";
// import { CreateCompanyModal } from "@/components/company/create-modal";
// import { Button } from "@/components/ui/button";
// import { useRouter } from "next/navigation";
// import InputSelect from "@/components/input/input-select";
// import RichTextInput from "@/components/input/rich-text-input";
// import ContentDocument, { MomContentSection } from "./content-document";
// import type { JSONContent } from "@tiptap/react";
// import Attachment from "@/app/mom/create/attachment-document";
// import DetailDocument from "./detail-document";
// import NextActionDocument from "./next-action-document";
// import { ApproverDocument } from "./approver-document";
// import AttachmentDocument from "@/app/mom/create/attachment-document";

// export interface MomForm {
//   companyId: string;
//   judul: string;
//   tanggalMom: string;
//   peserta: string;
//   venue: string;
//   waktu: string;
//   content: MomContentSection[];
//   approvers: {name: string}[];
//   attachments: { sectionName: string, files: File[] }[];
//   nextActions: { action: string; target: string; pic: string }[];
// }

// interface Company {
//   id: string;
//   name: string;
// }

// export default function CreateMomPage() {
//   const router = useRouter();
//   const [loading, setLoading] = useState(false);
//   const [companies, setCompanies] = useState<Company[]>([]);
//   const [form, setForm] = useState<MomForm>({
//     companyId: "",
//     judul: "",
//     tanggalMom: "",
//     peserta: "",
//     venue: "",
//     waktu: "",
//     content: [],
//     approvers: [{ name: "" }],
//     attachments: [{ sectionName: "", files: []  }],
//     nextActions: [{ action: "", target: "", pic: "" }],
//   });
  
//   const handleContentChange = useCallback((sections: MomContentSection[]) => {
//     setForm((prev) => ({ ...prev, content: sections }));
//   }, []);

//   function handleChange(field: keyof MomForm, value: string) {
//     setForm((prev) => ({ ...prev, [field]: value }));
//   }

//   async function handleSubmit(e: React.FormEvent) {
//     e.preventDefault();

//     const submitter = (e.nativeEvent as any).submitter;
//     const isFinish = submitter?.name === "finish" ? 1 : 0;

//     const required = ["companyId", "judul", "tanggalMom", "peserta", "venue", "waktu"];
//     for (const field of required) {
//       const value = form[field as keyof MomForm];

//       // kalau string, pastiin gak kosong
//       if (typeof value === "string" && value.trim() === "") {
//         alert(`Field ${field} wajib diisi.`);
//         return;
//       }

//       // kalau null/undefined
//       if (value === null || value === undefined) {
//         alert(`Field ${field} wajib diisi.`);
//         return;
//       }
//     }

//     // 1️⃣ Upload semua attachments ke MinIO
//     const uploadedAttachments = await Promise.all(
//       form.attachments.map(async (section) => {
//         // kalau ga ada file baru (misal sudah terupload)
//         const isFileArray = Array.isArray(section.files) && section.files.some(f => f instanceof File);
//         if (!isFileArray) {
//           // tetap kembalikan section agar ga hilang
//           return {
//             sectionName: section.sectionName,
//             files: section.files || [],
//           };
//         }

//         const formData = new FormData();
//         section.files.forEach((file) => {
//           if (file instanceof File) formData.append("files", file);
//         });

//         const res = await fetch("/api/uploads/attachment", {
//           method: "POST",
//           body: formData,
//         });

//         if (!res.ok) throw new Error("Gagal upload file di section " + section.sectionName);
//         const uploaded = await res.json();

//         // kalau single object, ubah jadi array
//         const filesArray = Array.isArray(uploaded) ? uploaded : [uploaded];

//         return {
//           sectionName: section.sectionName,
//           files: filesArray,
//         };
//       })
//     );

//     console.log("✅ Semua attachments:", uploadedAttachments);

//     // Format konten dari ContentDocument (TipTap)
//     const formatted = form.content.map((s: any) => ({
//       label: s.label, // pastikan title dari ContentDocument
//       content: s.content || "",
//     }));

//     // Gabung ke payload
//     const payload = {
//       ...form,
//       attachments: uploadedAttachments,
//       content: formatted,
//       nextActions: form.nextActions.filter(
//         (a) => a.action.trim() || a.target.trim() || a.pic.trim()
//       ),
//       is_finish: isFinish,
//     };

//     setLoading(true);
//     try {
//       const res = await fetch("/api/mom", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify(payload), // ✅ pake payload, bukan form
//       });

//       if (!res.ok) throw new Error("Gagal create MOM");

//       const data = await res.json();
//       alert("MOM berhasil dibuat!");

//       router.push(`/mom/list-mom`);
//     } catch (err) {
//       console.error(err);
//       alert("Gagal menyimpan MOM. Cek console untuk detail.");
//     } finally {
//       setLoading(false);
//     }
//   }

//   return (
//     <div className="container mx-auto py-8 px-4 max-w-6xl">
//       <form onSubmit={handleSubmit}>
//         {/* Detail MOM Section */}
//         <DetailDocument form={form} setForm={setForm} handleChange={handleChange} />
        
//         {/* Content MOM Section */}
//         <ContentDocument onChange={handleContentChange}/>
        
//         {/* Next Action Section */}
//         <NextActionDocument form={form} setForm={setForm} handleChange={handleChange} />

//         {/* Approver Section */}
//         <ApproverDocument form={form} handleChange={handleChange} />

//         {/* Attachment Section */}
//         <AttachmentDocument sections={form.attachments} handleChange={handleChange} />

//         {/* Action Buttons */}
//         <div className="w-full bg-white rounded-2xl shadow p-6">
//           <div className="flex gap-4 justify-end">
//             <Button
//               type="button"
//               variant="outline"
//               onClick={() => router.back()}
//               disabled={loading}
//             >
//               Cancel
//             </Button>
//             {/* Tombol Save biasa */}
//             <Button type="submit" name="save" disabled={loading}>
//               {loading ? "Saving..." : "Save"}
//             </Button>

//             {/* Tombol Save & Finish */}
//             <Button type="submit" name="finish" disabled={loading}>
//               {loading ? "Saving..." : "Save & Finish"}
//             </Button>
//           </div>
//         </div>
//       </form>
//     </div>
//   );
// }
