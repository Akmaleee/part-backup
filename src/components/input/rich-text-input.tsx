"use client";

import { useEditor, type JSONContent } from "@tiptap/react";
import { FaMinus, FaPlus } from "react-icons/fa";
import { IoMdArrowRoundDown, IoMdArrowRoundUp } from "react-icons/io";
import dynamic from "next/dynamic"; // 1. Import dynamic

// 2. Impor styling Tiptap di SINI (di komponen statis)
import "@/components/rich-text-editor/style.scss"; 

// 3. Muat RichTextEditor secara dinamis
const RichTextEditor = dynamic(
  () => import("@/components/rich-text-editor"), 
  {
    ssr: false, // 4. Matikan SSR untuk Tiptap
    loading: () => (
      // 5. Beri placeholder agar layout tidak "lompat"
      <div 
        className="rich-text-editor" 
        style={{ 
          height: '150px', 
          border: '1px solid #e0e0e0', 
          borderRadius: '8px', 
          padding: '10px' 
        }}
      >
        Loading editor...
      </div>
    )
  }
);

type Props = {
  index: number;
  total: number;
  title: string;
  // Tambahkan prop ini untuk halaman edit
  initialContent?: JSONContent | string | null; 
  content: JSONContent;
  onTitle: (v: string) => void;
  onContent: (v: JSONContent) => void;
  onAddBefore: () => void;
  onAddAfter: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  className?: string;
};

export default function RichTextInput({
  index,
  total,
  title,
  content, // 'content' di sini mungkin tidak lagi diperlukan jika 'initialContent' dipakai
  onTitle,
  onContent,
  onAddBefore,
  onAddAfter,
  onMoveUp,
  onMoveDown,
  onRemove,
  className,
  initialContent // Terima prop ini
}: Props) {
  const buttons = [
    { icon: <FaPlus size={12} />, onClick: onAddBefore },
    { icon: <IoMdArrowRoundUp size={16} />, onClick: onMoveUp, disabled: index === 0 },
    { icon: <IoMdArrowRoundDown size={16} />, onClick: onMoveDown, disabled: index === total - 1 },
    { icon: <FaMinus size={12} />, onClick: onRemove, danger: true },
  ];

  return (
    <div className={className}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          className="w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2 focus:ring-gray-300"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder={`${index + 1}`}
        />
        <div className="mt-2 flex gap-2 sm:mt-0">
          {buttons.map(({ icon, onClick, disabled, danger }, idx) => (
            <button
              key={idx}
              onClick={onClick}
              disabled={disabled}
              type="button"
              className={[
                "flex items-center justify-center rounded-lg border p-2 hover:bg-gray-50 disabled:opacity-40",
                danger ? "text-red-600 hover:bg-red-50" : "",
              ].join(" ")}
              aria-label={`btn-${idx}`}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        {/* 6. Kirim initialContent ke editor */}
        <RichTextEditor 
          content={initialContent || content} // Prioritaskan initialContent
          onChange={onContent} 
        />
      </div>
    </div>
  );
}

// "use client";

// import { type JSONContent } from "@tiptap/react";
// import { FaMinus, FaPlus } from "react-icons/fa";
// import { IoMdArrowRoundDown, IoMdArrowRoundUp } from "react-icons/io";
// import dynamic from "next/dynamic";

// // 1. Impor styling Tiptap di komponen statis ini
// import "@/components/rich-text-editor/style.scss"; 

// // 2. Muat RichTextEditor secara dinamis
// const RichTextEditor = dynamic(
//   () => import("@/components/rich-text-editor"), 
//   {
//     ssr: false, // Matikan SSR untuk Tiptap
//     loading: () => (
//       // Beri placeholder agar layout tidak "lompat"
//       <div 
//         className="rich-text-editor" 
//         style={{ 
//           height: '150px', 
//           border: '1px solid #e0e0e0', 
//           borderRadius: '8px', 
//           padding: '10px' 
//         }}
//       >
//         Loading editor...
//       </div>
//     )
//   }
// );

// type Props = {
//   index: number;
//   total: number;
//   title: string;
//   // --- PERBAIKAN DI SINI ---
//   // Terima tipe data yang fleksibel dari database
//   content: JSONContent | string | null | undefined;
//   onTitle: (v: string) => void;
//   onContent: (v: JSONContent) => void;
//   onAddBefore: () => void;
//   onAddAfter: () => void;
//   onMoveUp: () => void;
//   onMoveDown: () => void;
//   onRemove: () => void;
//   className?: string;
// };

// export default function RichTextInput({
//   index,
//   total,
//   title,
//   content,
//   onTitle,
//   onContent,
//   onAddBefore,
//   onAddAfter,
//   onMoveUp,
//   onMoveDown,
//   onRemove,
//   className
// }: Props) {
//   const buttons = [
//     { icon: <FaPlus size={12} />, onClick: onAddBefore },
//     { icon: <IoMdArrowRoundUp size={16} />, onClick: onMoveUp, disabled: index === 0 },
//     { icon: <IoMdArrowRoundDown size={16} />, onClick: onMoveDown, disabled: index === total - 1 },
//     { icon: <FaMinus size={12} />, onClick: onRemove, danger: true },
//   ];

//   return (
//     <div className={className}>
//       <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
//         <input
//           className="w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2 focus:ring-gray-300"
//           value={title}
//           onChange={(e) => onTitle(e.target.value)}
//           placeholder={`${index + 1}`}
//         />
//         <div className="mt-2 flex gap-2 sm:mt-0">
//           {buttons.map(({ icon, onClick, disabled, danger }, idx) => (
//             <button
//               key={idx}
//               onClick={onClick}
//               disabled={disabled}
//               type="button"
//               className={[
//                 "flex items-center justify-center rounded-lg border p-2 hover:bg-gray-50 disabled:opacity-40",
//                 danger ? "text-red-600 hover:bg-red-50" : "",
//               ].join(" ")}
//               aria-label={`btn-${idx}`}
//             >
//               {icon}
//             </button>
//           ))}
//         </div>
//       </div>

//       <div className="mt-3">
//         {/* Sekarang 'content' (yang bertipe string | JSONContent | null)
//             bisa diteruskan dengan aman ke RichTextEditor */}
//         <RichTextEditor content={content} onChange={onContent} />
//       </div>
//     </div>
//   );
// }

// "use client";

// import { useEditor, type JSONContent } from "@tiptap/react";
// import { FaMinus, FaPlus } from "react-icons/fa";
// import { IoMdArrowRoundDown, IoMdArrowRoundUp } from "react-icons/io";
// import dynamic from "next/dynamic"; // 1. Import dynamic

// // 2. Impor styling Tiptap di SINI (di komponen statis)
// import "@/components/rich-text-editor/style.scss"; 

// // 3. Muat RichTextEditor secara dinamis
// const RichTextEditor = dynamic(
//   () => import("@/components/rich-text-editor"), 
//   {
//     ssr: false, // 4. Matikan SSR untuk Tiptap
//     loading: () => (
//       // 5. Beri placeholder agar layout tidak "lompat"
//       <div 
//         className="rich-text-editor" 
//         style={{ 
//           height: '150px', 
//           border: '1px solid #e0e0e0', 
//           borderRadius: '8px', 
//           padding: '10px' 
//         }}
//       >
//         Loading editor...
//       </div>
//     )
//   }
// );

// type Props = {
//   index: number;
//   total: number;
//   title: string;
//   content: JSONContent;
//   onTitle: (v: string) => void;
//   onContent: (v: JSONContent) => void;
//   onAddBefore: () => void;
//   onAddAfter: () => void;
//   onMoveUp: () => void;
//   onMoveDown: () => void;
//   onRemove: () => void;
//   className?: string;
//   // Tambahkan prop ini untuk halaman edit
//   initialContent?: JSONContent | string | null; 
// };

// export default function RichTextInput({
//   index,
//   total,
//   title,
//   content, // 'content' di sini mungkin tidak lagi diperlukan jika 'initialContent' dipakai
//   onTitle,
//   onContent,
//   onAddBefore,
//   onAddAfter,
//   onMoveUp,
//   onMoveDown,
//   onRemove,
//   className,
//   initialContent // Terima prop ini
// }: Props) {
//   const buttons = [
//     { icon: <FaPlus size={12} />, onClick: onAddBefore },
//     { icon: <IoMdArrowRoundUp size={16} />, onClick: onMoveUp, disabled: index === 0 },
//     { icon: <IoMdArrowRoundDown size={16} />, onClick: onMoveDown, disabled: index === total - 1 },
//     { icon: <FaMinus size={12} />, onClick: onRemove, danger: true },
//   ];

//   return (
//     <div className={className}>
//       <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
//         <input
//           className="w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2 focus:ring-gray-300"
//           value={title}
//           onChange={(e) => onTitle(e.target.value)}
//           placeholder={`${index + 1}`}
//         />
//         <div className="mt-2 flex gap-2 sm:mt-0">
//           {buttons.map(({ icon, onClick, disabled, danger }, idx) => (
//             <button
//               key={idx}
//               onClick={onClick}
//               disabled={disabled}
//               type="button"
//               className={[
//                 "flex items-center justify-center rounded-lg border p-2 hover:bg-gray-50 disabled:opacity-40",
//                 danger ? "text-red-600 hover:bg-red-50" : "",
//               ].join(" ")}
//               aria-label={`btn-${idx}`}
//             >
//               {icon}
//             </button>
//           ))}
//         </div>
//       </div>

//       <div className="mt-3">
//         {/* 6. Kirim initialContent ke editor */}
//         <RichTextEditor 
//           content={initialContent || content} // Prioritaskan initialContent
//           onChange={onContent} 
//         />
//       </div>
//     </div>
//   );
// }

// "use client";

// import { useEditor, EditorContent } from "@tiptap/react";
// import StarterKit from "@tiptap/starter-kit";
// import MenuBar from "@/components/rich-text-editor/menu-bar"; // Perbaikan: Impor default
// import "@/components/rich-text-editor/style.scss";
// import { Image } from "@tiptap/extension-image";
// import {
//   Table,
//   TableRow,         // Perbaikan: Impor dari 'extension-table'
//   TableCell,        // Perbaikan: Impor dari 'extension-table'
//   TableHeader,      // Perbaikan: Impor dari 'extension-table'
// } from "@tiptap/extension-table";
// import { Gapcursor } from "@tiptap/extension-gapcursor";
// import { Highlight } from "@tiptap/extension-highlight";
// import { Dropcursor } from "@tiptap/extension-dropcursor";
// import { TextAlign } from "@tiptap/extension-text-align";
// import type { JSONContent } from "@tiptap/react";

// interface RichTextInputProps {
//   onUpdate: (json: JSONContent) => void;
//   initialContent?: JSONContent | string | null;
// }

// // Fungsi helper upload HANYA untuk drag-and-drop
// // (Menggantikan hook useImageUpload yang error)
// async function uploadFileOnDrop(file: File): Promise<string | undefined> {
//   try {
//     const presignRes = await fetch(
//       `/api/uploads/presign?filename=${encodeURIComponent(file.name)}&filetype=${encodeURIComponent(file.type)}`
//     );
//     if (!presignRes.ok) throw new Error("Gagal mendapatkan presigned URL");
    
//     const { url, fields } = await presignRes.json();
//     const key = fields.key; 

//     const formData = new FormData();
//     Object.entries(fields).forEach(([key, value]) => {
//       formData.append(key, value as string);
//     });
//     formData.append("file", file);

//     const uploadRes = await fetch(url, {
//       method: "POST",
//       body: formData,
//     });

//     if (!uploadRes.ok) throw new Error("Gagal upload file");

//     // Pastikan URL env Anda benar (misal: http://127.0.0.1:9000/partnership)
//     const publicUrl = `${process.env.NEXT_PUBLIC_MINIO_PUBLIC_URL}/${key}`;
//     return publicUrl;
//   } catch (error) {
//     console.error("Error uploading image on drop:", error);
//     alert("Gagal meng-upload gambar. Cek console untuk detail.");
//     return undefined;
//   }
// }

// export default function RichTextInput({
//   onUpdate,
//   initialContent,
// }: RichTextInputProps) {
  
//   const editor = useEditor({
//     // --- PERBAIKAN UTAMA DI SINI ---
//     immediatelyRender: false,
//     // --------------------------------

//     extensions: [
//       StarterKit.configure({
//         // 'history: false' dihapus, itu penyebab error
//       }),
//       Image.configure({
//         inline: true,
//         allowBase64: true,
//       }),
//       Table.configure({
//         resizable: true,
//       }),
//       TableRow,
//       TableHeader,
//       TableCell,
//       Gapcursor,
//       Highlight,
//       Dropcursor,
//       TextAlign.configure({
//         types: ["heading", "paragraph"],
//       }),
//     ],
//     content: initialContent || "",
//     editorProps: {
//       attributes: {
//         class: "rich-text-editor",
//       },
//       handleDrop: (view, event, slice, moved) => {
//         if (
//           !moved &&
//           event.dataTransfer &&
//           event.dataTransfer.files &&
//           event.dataTransfer.files.length > 0
//         ) {
//           const files = event.dataTransfer.files;
//           const pos = view.posAtCoords({
//             left: event.clientX,
//             top: event.clientY,
//           });

//           if (pos) {
//             for (let i = 0; i < files.length; i++) {
//               if (files[i].type.startsWith("image/")) {
//                 // Panggil fungsi upload lokal
//                 uploadFileOnDrop(files[i]).then(
//                   (url: string | undefined) => { // Perbaikan: 'url' adalah string
//                     if (url) {
//                       const { schema } = view.state;
//                       const node = schema.nodes.image.create({ src: url });
//                       const transaction = view.state.tr.insert(pos.pos, node);
//                       view.dispatch(transaction);
//                     }
//                   }
//                 );
//               }
//             }
//             return true;
//           }
//         }
//         return false;
//       },
//     },
//     onUpdate: ({ editor }) => {
//       onUpdate(editor.getJSON());
//     },
//   });

//   return (
//     <div className="rich-text-container">
//       {editor && <MenuBar editor={editor} />}
//       <EditorContent editor={editor} />
//     </div>
//   );
// }

// "use client";

// import { useEditor, type JSONContent } from "@tiptap/react";
// import { FaMinus, FaPlus } from "react-icons/fa";
// import { IoMdArrowRoundDown, IoMdArrowRoundUp } from "react-icons/io";
// import RichTextEditor from "@/components/rich-text-editor";

// type Props = {
//   index: number;
//   total: number;
//   title: string;
//   content: JSONContent;
//   onTitle: (v: string) => void;
//   onContent: (v: JSONContent) => void;
//   onAddBefore: () => void;
//   onAddAfter: () => void;
//   onMoveUp: () => void;
//   onMoveDown: () => void;
//   onRemove: () => void;
//   className?: string;
// };

// export default function RichTextInput({
//   index,
//   total,
//   title,
//   content,
//   onTitle,
//   onContent,
//   onAddBefore,
//   onAddAfter,
//   onMoveUp,
//   onMoveDown,
//   onRemove,
//   className
// }: Props) {
//   const buttons = [
//     { icon: <FaPlus size={12} />, onClick: onAddBefore },
//     { icon: <IoMdArrowRoundUp size={16} />, onClick: onMoveUp, disabled: index === 0 },
//     { icon: <IoMdArrowRoundDown size={16} />, onClick: onMoveDown, disabled: index === total - 1 },
//     { icon: <FaMinus size={12} />, onClick: onRemove, danger: true },
//   ];

//   return (
//     <div className={className}>
//       <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
//         <input
//           className="w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2 focus:ring-gray-300"
//           value={title}
//           onChange={(e) => onTitle(e.target.value)}
//           placeholder={`${index + 1}`}
//         />
//         <div className="mt-2 flex gap-2 sm:mt-0">
//           {buttons.map(({ icon, onClick, disabled, danger }, idx) => (
//             <button
//               key={idx}
//               onClick={onClick}
//               disabled={disabled}
//               type="button"
//               className={[
//                 "flex items-center justify-center rounded-lg border p-2 hover:bg-gray-50 disabled:opacity-40",
//                 danger ? "text-red-600 hover:bg-red-50" : "",
//               ].join(" ")}
//               aria-label={`btn-${idx}`}
//             >
//               {icon}
//             </button>
//           ))}
//         </div>
//       </div>

//       <div className="mt-3">
//         <RichTextEditor content={content} onChange={onContent} />
//       </div>
//     </div>
//   );
// }
