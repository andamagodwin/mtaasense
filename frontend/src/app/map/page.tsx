import type { Metadata } from "next";
import { MapExplorer } from "@/components/map/map-explorer";

export const metadata: Metadata = { title: "Incident map" };

export default function MapPage() {
  return <MapExplorer />;
}
