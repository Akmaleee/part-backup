"use client";

import { useEditor, type JSONContent } from "@tiptap/react";
import { FaMinus, FaPlus } from "react-icons/fa";
import { IoMdArrowRoundDown, IoMdArrowRoundUp } from "react-icons/io";
import RichTextEditor from "@/components/rich-text-editor";

type Props = {
  index: number;
  total: number;
  title: string;
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
  content,
  onTitle,
  onContent,
  onAddBefore,
  onAddAfter,
  onMoveUp,
  onMoveDown,
  onRemove,
  className
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
        <RichTextEditor content={content} onChange={onContent} />
      </div>
    </div>
  );
}
