import React from "react";
import type { ConnectionStatusItem } from "@shared/types";

export interface StatusCardProps {
  label: string;
  statusItem: ConnectionStatusItem;
}

export default function StatusCard({ label, statusItem }: StatusCardProps) {
  return (
    <div className={`status-card ${statusItem.ok ? "connected" : "disconnected"}`}>
      <div className="status-card-head">
        <strong>{label}</strong>
        <span className={statusItem.ok ? "status-dot ok" : "status-dot bad"} />
      </div>
      <p>{statusItem.message}</p>
    </div>
  );
}
