import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "JIK Module"
};

export default function JikModulePage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Create New JIK</h2>
      <p>This is the page to create a new JIK document.</p>
    </div>
  );
}