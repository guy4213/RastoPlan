export function Legend() {
  return (
    <section style={{ padding: 12, borderTop: "1px solid #e2e8f0", fontSize: 12 }}>
      <h2 style={{ margin: "0 0 6px 0", fontSize: 13, fontWeight: 600 }}>מקרא</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Swatch fill="#dcfce7" stroke="#15803d" label="פאה שגובלת בחדר" />
        <Swatch fill="#dbeafe" stroke="#1d4ed8" label="פאה שגובלת בחוץ" />
        <Swatch fill="#cffafe" stroke="#0e7490" label="פאנל פינה C30x30" />
        <Swatch fill="#e0e7ff" stroke="#4f46e5" label="בליטת פינה חיצונית" />
        <Swatch fill="#fde68a" stroke="#a16207" label="פער עץ" />
        <Swatch fill="#fef3c7" stroke="#b45309" label="עריכה ידנית" />
        <Swatch fill="#fecaca" stroke="#b91c1c" label="דגל / דורש טיפול" />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-block",
              width: 20,
              height: 0,
              borderTop: "3px dashed #94a3b8",
              flexShrink: 0,
            }}
          />
          <span>קו שזוהה כפאה השנייה של קיר אחר</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-flex",
              width: 20,
              height: 12,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              flexShrink: 0,
            }}
          >
            <Dot />
            <Dot />
            <Dot />
          </span>
          <span>קלמרות K30 בפינה</span>
        </div>
      </div>
      <p style={{ margin: "8px 0 0 0", color: "#64748b", fontSize: 11, lineHeight: 1.5 }}>
        גלגלת עכבר: זום · גרירה: פאן (במצב "בחירה") · Delete: מחיקה
      </p>
    </section>
  );
}

function Dot() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 5,
        height: 5,
        borderRadius: "50%",
        background: "#ea580c",
        border: "1px solid #7c2d12",
      }}
    />
  );
}

function Swatch({ fill, stroke, label }: { fill: string; stroke: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          display: "inline-block",
          width: 20,
          height: 12,
          background: fill,
          border: `1px solid ${stroke}`,
          borderRadius: 2,
          flexShrink: 0,
        }}
      />
      <span>{label}</span>
    </div>
  );
}
