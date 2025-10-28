"use client";

import { InputString } from "@/components/input";
import { MomForm } from "./page";

interface ApproverDocumentProps {
  form: MomForm;
  handleChange: <K extends keyof MomForm>(field: K, value: MomForm[K]) => void;
}

export function ApproverDocument({ form, handleChange }: ApproverDocumentProps) {
  return (
    <div className="w-full bg-white rounded-2xl shadow p-6 mb-6">
      <h2 className="text-lg font-bold text-gray-900 mb-6">Approvers</h2>

      <div className="space-y-4">
        {form.approvers?.map((approver, index) => (
          <div key={index} className="flex items-center gap-3">
            <div className="flex-1">
              <InputString
                title={index === 0 ? "Penyetuju" : ""}
                id={`approver-${index}`}
                value={approver.name}
                onChange={(e) => {
                  const newApprovers = [...form.approvers];
                  newApprovers[index].name = e.target.value;
                  handleChange("approvers", newApprovers);
                }}
              />
            </div>

            {/* Tombol hapus */}
            {form.approvers.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const updated = form.approvers.filter((_, i) => i !== index);
                  handleChange("approvers", updated);
                }}
                className="p-2 rounded-lg border border-gray-300 text-red-600 hover:bg-red-50"
              >
                ✕
              </button>
            )}
          </div>
        ))}

        {/* Tombol tambah */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              handleChange("approvers", [...form.approvers, { name: "" }]);
            }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 text-gray-700 text-sm"
          >
            <span className="text-lg">＋</span> Tambah Approver
          </button>
        </div>
      </div>
    </div>
  );
}
