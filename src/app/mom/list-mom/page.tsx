"use client";

import { DataTable } from "@/components/layout/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export default function ListMomPage() {

  const [moms, setMoms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/mom")
      .then((res) => res.json())
      .then((data) => {
          const formatted = data.map((mom: any) => ({
          ...mom,
          date: new Date(mom.date).toLocaleDateString("id-ID", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          }),
        }));
        setMoms(formatted);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const columns = [
    { key: "company.name", label: "Nama Perusahaan" },
    { key: "title", label: "Judul MOM" },
    { key: "date", label: "Tanggal MOM" },
    { key: "venue", label: "Tempat Dilaksanakan" },
  ];

  // 🔍 Filter data secara real-time
  const filteredMoms = useMemo(() => {
    return moms.filter((c) =>
      c.company?.name.toLowerCase().includes(filter.toLowerCase())
    );
  }, [moms, filter]);

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
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="animate-spin mr-2 h-5 w-5" />
              <span>Loading data...</span>
            </div>
          ) : (
            <DataTable columns={columns} data={filteredMoms} type="mom" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}