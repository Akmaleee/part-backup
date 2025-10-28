"use client";

import React, { useState } from "react";
import DetailDocument, { Form } from "./detail-document";
import { Button } from "@/components/ui/button";
import ContentDocument, { ContentSection } from "./content-document"; // <= export tipe
import { gql } from "@apollo/client";
import { useMutation } from "@apollo/client/react";
import type { JSONContent } from "@tiptap/react";

const CREATE_DOCUMENT = gql`
  mutation CreateDocument($input: CreateDocumentInput!) {
    createDocument(input: $input) {
      id
      companyName
      contractDurationYears
      createdAt
    }
  }
`;

// helper: konversi durasi ke "tahun"
function toYears(d?: { amount: number; unit: "day" | "month" | "year" } | null) {
  if (!d) return undefined;
  if (typeof d.amount !== "number" || Number.isNaN(d.amount)) return undefined;
  switch (d.unit) {
    case "day": return d.amount / 365;
    case "month": return d.amount / 12;
    case "year": return d.amount;
    default: return undefined;
  }
}

export default function JikModule() {
  const [form, setForm] = useState<Form>({
    companyName: "",
    jikTitle: "",
    unitName: "",
    initiativePartnership: "",
    investValue: null,
    contractDuration: null,
  });

  // sections dari ContentDocument (di-lift up)
  const [sections, setSections] = useState<ContentSection[]>([]);

  const [createDocument, { loading }] = useMutation(CREATE_DOCUMENT);

  async function handleSubmit() {
    // --- VALIDASI RINGAN ---
    const companyName = form.companyName?.trim() ?? "";
    const jikTitle = form.jikTitle?.trim() ?? "";
    const unitName = form.unitName?.trim() ?? "";
    if (!companyName || !jikTitle || !unitName) {
      alert("Company Name, JIK Title, dan Unit Name wajib diisi.");
      return;
    }

    // --- NORMALISASI NILAI ---
    const initiativePartnership = form.initiativePartnership?.trim() || undefined;

    // investValue -> string (ikut pattern kode kamu sebelumnya)
    const investValue =
      form.investValue !== null && form.investValue !== undefined
        ? String(form.investValue)
        : undefined;

    // contractDuration -> tahun (number)
    const contractDurationYears = toYears(form.contractDuration);
    console.log(toYears(form.contractDuration));
    

    // --- SIAPKAN PAYLOAD ---
    const detailPayload = {
      companyName,
      jikTitle,
      unitName,
      initiativePartnership,
      investValue,
      contractDurationYears,
    };

    // Content/Mongo payload (trap dulu)
    const contentPayload = {
      sections: sections.map((s) => ({
        title: s.title,
        content: s.content as JSONContent,
      })),
    };

    // --- LOG DULU BIAR KELIHATAN (trap) ---
    console.log("[DETAIL → Postgres]", detailPayload);
    console.log("[CONTENT → Mongo]", contentPayload);

    try {
      // 1) Simpan detail ke Postgres
      const res = await createDocument({
        variables: { input: detailPayload },
      });

      // (opsional) ambil id dokumen buat link ke Mongo nanti
      const documentId: string | undefined = res?.data?.createDocument?.id;

      // 2) Simpan content ke Mongo → TODO: sambungkan mutation di sini
      // await createDocumentContent({ variables: { documentId, sections: contentPayload.sections } });

      alert("Draft tersimpan (Detail OK, Content tertangkap di console).");

      // Reset form + (opsional) reset sections
      setForm({
        companyName: "",
        jikTitle: "",
        unitName: "",
        initiativePartnership: "",
        investValue: null,
        contractDuration: null,
      });
      // Jika mau reset content juga, aktifkan baris ini:
      // setSections([]);
    } catch (err) {
      console.error(err);
      alert("Gagal menyimpan. Cek console untuk detail error.");
    }
  }

  return (
    <>
      <DetailDocument form={form} setForm={setForm} />

      <div className="bg-white w-full rounded-2xl shadow p-6 mt-6">

        {/* TERIMA CALLBACK SECTIONS */}
        <ContentDocument onChange={setSections} />

        <Button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? "Saving..." : "Save"}
        </Button>
      </div>
    </>
  );
}
