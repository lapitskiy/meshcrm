import ModuleSectionDetails from "@/components/modules/ModuleSectionDetails";
import React from "react";

export default function ModuleSectionPage({
  params,
}: {
  params: { name: string; section: string };
}) {
  return <ModuleSectionDetails name={params.name} section={params.section} />;
}

