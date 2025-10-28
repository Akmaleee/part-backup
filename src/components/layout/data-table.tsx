"use client";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal } from "lucide-react";
import { StatusTracker } from "./status-tracker";

interface DataTableProps {
  caption?: string;
  columns: { key: string; label: string }[];
  data: Record<string, any>[];
  type?: "mom" | "nda" | "company" | "msa" | "mou" | "jik" | string; // 🆕 menentukan jenis tabel
  onView?: (row: any) => void;
  onEdit?: (row: any) => void;
  onDelete?: (row: any) => void;
}

export function DataTable({
  caption,
  columns,
  data,
  type = "default", // default fallback
  onView,
  onEdit,
  onDelete,
}: DataTableProps) {
  const getValue = (obj: any, path: string) =>
    path.split(".").reduce((acc, part) => acc && acc[part], obj);

  // apakah perlu menampilkan kolom status?
  const showStatus = type.toLowerCase() === "mom" || "nda" || "company" || "msa" || "mou" || "jik";

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        {caption && <TableCaption>{caption}</TableCaption>}

        <TableHeader>
          <TableRow>
            {/* Kolom penomoran */}
            <TableHead className="w-[50px] text-center">No</TableHead>

            {/* Kolom dinamis */}
            {columns.map((col) => (
              <TableHead key={col.key}>{col.label}</TableHead>
            ))}

            {/* Kolom status (opsional) */}
            {showStatus && <TableHead>Status</TableHead>}

            {/* Kolom aksi */}
            <TableHead className="w-[60px]"></TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {data.length > 0 ? (
            data.map((row, i) => (
              <TableRow key={i}>
                {/* Nomor urut */}
                <TableCell className="text-center font-medium">
                  {i + 1}
                </TableCell>

                {/* Data utama */}
                {columns.map((col) => (
                  <TableCell key={col.key}>
                    {getValue(row, col.key) ?? "-"}
                  </TableCell>
                ))}

                {/* Status hanya muncul jika type === "mom" */}
                {showStatus && (
                  <TableCell>
                    <StatusTracker
                      stepName={row.progress?.step?.name || type}
                      currentStatus={row.progress?.status?.name || "Draft"}
                    />
                  </TableCell>
                )}

                {/* Aksi */}
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onView?.(row)}>
                        View
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit?.(row)}>
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-600"
                        onClick={() => onDelete?.(row)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length + (showStatus ? 3 : 2)} // dinamis tergantung status
                className="text-center py-6 text-muted-foreground"
              >
                No data available
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
