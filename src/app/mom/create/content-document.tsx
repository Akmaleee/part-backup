"use client";

import { useMemo, useReducer, useRef, useEffect } from "react";
import type { JSONContent } from "@tiptap/react";
import { FaPlus } from "react-icons/fa";
import RichTextInput from "@/components/input/rich-text-input";

export type MomContentSection = { label: string; content: JSONContent };

const DEFAULT_TITLES = [
  "Latar Belakang",
  "Key Point",
  "Ruang lingkup dan deskripsi inisiatif Kerja Sama",
  "Hak & Kewajiban",
  // "Next Action",
] as const;

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

type Section = { id: string; label: string; content: JSONContent };

type Action =
  | { type: "add"; index: number; offset: -1 | 1 }
  | { type: "addEnd" }
  | { type: "remove"; index: number }
  | { type: "move"; index: number; dir: -1 | 1 }
  | { type: "update"; id: string; patch: Partial<Pick<Section, "label" | "content">> }
  | { type: "resetDefault" };

export default function ContentDocument({
  onChange,
}: {
  onChange?: (sections: MomContentSection[]) => void;
}) {
  const seq = useRef(0);
  const newId = () => `sec_${seq.current++}`;

  const initialSections = useMemo<Section[]>(
    () => DEFAULT_TITLES.map((t) => ({ id: newId(), label: t, content: EMPTY_DOC })),
    []
  );

  const reducer = (state: Section[], action: Action): Section[] => {
    switch (action.type) {
      case "add": {
        const idx = Math.max(0, Math.min(action.index + (action.offset === -1 ? 0 : 1), state.length));
        const draft = [...state];
        draft.splice(idx, 0, { id: newId(), label: "Bagian Baru", content: EMPTY_DOC });
        return draft;
      }
      case "addEnd":
        return [...state, { id: newId(), label: "Bagian Baru", content: EMPTY_DOC }];
      case "remove":
        return state.length <= 1 ? state : state.filter((_, i) => i !== action.index);
      case "move": {
        const from = action.index;
        const to = from + action.dir;
        if (to < 0 || to >= state.length) return state;
        const draft = [...state];
        [draft[from], draft[to]] = [draft[to], draft[from]];
        return draft;
      }
      case "update":
        return state.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s));
      case "resetDefault":
        return DEFAULT_TITLES.map((t) => ({ id: newId(), label: t, content: EMPTY_DOC }));
      default:
        return state;
    }
  };

  const [sections, dispatch] = useReducer(reducer, initialSections);

  // ⬇️ Emit ke parent dengan format { label, content }
  useEffect(() => {
    const formatted = sections.map((s) => ({
      label: s.label,
      content: s.content, // bisa juga stringify di sini kalau mau langsung disimpan
    }));
    onChange?.(formatted);
  }, [sections, onChange]);

  return (
    <div className="w-full bg-white rounded-2xl shadow p-6 mb-6">
      <Header onReset={() => dispatch({ type: "resetDefault" })} />

      <div className="divide-y">
        {sections.map((s, i) => (
          <RichTextInput
            key={s.id}
            className="py-6"
            index={i}
            total={sections.length}
            title={s.label}
            content={s.content}
            onTitle={(v) => dispatch({ type: "update", id: s.id, patch: { label: v } })}
            onContent={(v) => dispatch({ type: "update", id: s.id, patch: { content: v } })}
            onAddBefore={() => dispatch({ type: "add", index: i, offset: -1 })}
            onAddAfter={() => dispatch({ type: "add", index: i, offset: 1 })}
            onMoveUp={() => dispatch({ type: "move", index: i, dir: -1 })}
            onMoveDown={() => dispatch({ type: "move", index: i, dir: 1 })}
            onRemove={() => dispatch({ type: "remove", index: i })}
          />
        ))}
      </div>

      <div className="w-full flex items-center justify-center">
        <button
          onClick={() => dispatch({ type: "addEnd" })}
          aria-label="Tambah Section"
          className="flex items-center justify-center rounded-full border border-gray-300 p-2 hover:bg-gray-100 transition"
        >
          <FaPlus size={14} className="text-gray-600" />
        </button>
      </div>
    </div>
  );
}

function Header({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-lg font-bold text-gray-900 mr-auto">Konten MOM</h2>
      <button
        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
        onClick={onReset}
      >
        Reset ke Default
      </button>
    </div>
  );
}
