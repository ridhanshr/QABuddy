import React from "react";
import type { ViewKey } from "@shared/types";

export interface NavItem {
  key: ViewKey;
  label: string;
  icon: string;
  filledIcon?: string;
}

export interface NavigationButtonProps {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}

export default function NavigationButton({
  item,
  active,
  onClick,
}: NavigationButtonProps) {
  return (
    <button className={active ? "nav-item active" : "nav-item"} onClick={onClick} type="button">
      <span className={active ? "material-symbols nav-icon filled" : "material-symbols nav-icon"}>
        {active ? item.filledIcon || item.icon : item.icon}
      </span>
      <span>{item.label}</span>
    </button>
  );
}
