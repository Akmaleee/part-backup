"use client";

import React from "react";
import { InputString, TextArea, CurrencyInput, DurationTimeInput } from "@/components/input";

export type FieldProps = {
  id: string;
  title: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

export type DurationValue = { amount: number; unit: "day" | "month" | "year" };

export type Form = {
  companyName: string;
  jikTitle: string;
  unitName: string;
  initiativePartnership: string;
  investValue?: number | null;
  contractDuration?: DurationValue | null;
};

type TextKey = keyof Pick<Form, "companyName" | "jikTitle" | "unitName" | "initiativePartnership">;
type FieldComp = React.ComponentType<FieldProps>;

const TEXT_FIELDS: ReadonlyArray<{ key: TextKey; title: string; Component: FieldComp }> = [
  { key: "companyName",           title: "Company Name",           Component: InputString },
  { key: "jikTitle",              title: "JIK Title",              Component: InputString },
  { key: "unitName",              title: "Unit Name",              Component: InputString },
  { key: "initiativePartnership", title: "Initiative Partnership", Component: TextArea    },
] as const;

type DetailDocumentProps = {
  form: Form;
  setForm: React.Dispatch<React.SetStateAction<Form>>;
};

export default function DetailDocument({ form, setForm }: DetailDocumentProps) {
  // Handler aman: ambil value lebih dulu, baru panggil setForm
  const on =
    (k: TextKey) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = e.target?.value ?? "";
      setForm((p) => ({ ...p, [k]: value }));
    };

  // Setter util untuk komponen dengan onValueChange(v)
  function setVal<K extends keyof Form>(k: K) {
    return (v: Form[K]) => setForm((p) => ({ ...p, [k]: v }));
  }

  return (
    <div className="bg-white w-full rounded-2xl shadow p-6">
      <h1 className="font-bold mb-6 text-xl">Detail Document</h1>

      {TEXT_FIELDS.map(({ key, title, Component }) => (
        <div key={key} className="w-full flex flex-col mb-4">
          <Component
            id={key}
            title={title}
            value={String(form[key] ?? "")}
            onChange={on(key)}
          />
        </div>
      ))}

      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <CurrencyInput
          label="Invest Value"
          value={form.investValue ?? undefined}
          onValueChange={setVal("investValue")}
        />
        <DurationTimeInput
          label="Contract Duration"
          value={form.contractDuration ?? undefined}
          onValueChange={setVal("contractDuration")}
        />
      </div>
    </div>
  );
}
