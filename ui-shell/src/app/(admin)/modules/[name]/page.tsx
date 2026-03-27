import ModuleDetails from "@/components/modules/ModuleDetails";
import React from "react";

export default function ModuleDetailsPage({ params }: { params: { name: string } }) {
  return <ModuleDetails name={params.name} />;
}

