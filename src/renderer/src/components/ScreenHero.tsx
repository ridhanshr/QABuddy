import React from "react";

export default function ScreenHero({
  icon,
  title,
  description,
  eyebrow = "Quality control workspace",
}: {
  icon: string;
  title: string;
  description: string;
  eyebrow?: string;
}) {
  return (
    <header className="review-hero screen-hero">
      <div className="screen-icon">
        <span className="material-symbols filled" style={{ fontSize: 25 }}>{icon}</span>
      </div>
      <div>
        <div className="screen-hero-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}
