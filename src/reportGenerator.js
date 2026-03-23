// src/reportGenerator.js
// Generates PDF and DOCX compliance reports from Vigilante scan data
// PDF: jsPDF (loaded via CDN script tag injected at runtime)
// DOCX: docx npm package (bundled by Vite)

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, UnderlineType,
} from "docx";

// ─── Risk helpers ────────────────────────────────────────────────────────────
const RL = (s) => s <= 25 ? "LOW" : s <= 54 ? "MEDIUM" : s <= 74 ? "HIGH" : "CRITICAL";
const RL_COLOR = { LOW:"00C47A", MEDIUM:"D4A017", HIGH:"D4520A", CRITICAL:"CC1133" };
const SIGNAL_LABELS = {
  sanctionsExposure:  "Sanctions Exposure",
  darknetExposure:    "Darknet Exposure",
  mixerTumblerUsage:  "Mixer / Tumbler Usage",
  stolenFundsRisk:    "Stolen Funds Risk",
  ransomwareExposure: "Ransomware Exposure",
  scamExposure:       "Scam Exposure",
  peerToPeerExposure: "Peer-to-Peer Exposure",
  exchangeRisk:       "Exchange Risk",
};
const SIGNAL_DESC = {
  sanctionsExposure:  "Direct or indirect exposure to OFAC SDN listed addresses or sanctioned entities.",
  darknetExposure:    "Transactions linked to known darknet marketplaces or illicit services.",
  mixerTumblerUsage:  "Interaction with cryptocurrency mixing or tumbling services designed to obscure fund flows.",
  stolenFundsRisk:    "Proximity to addresses associated with hacked protocols or stolen funds.",
  ransomwareExposure: "Linkage to addresses used in ransomware payment campaigns.",
  scamExposure:       "Transactions connected to known scam or fraud operations.",
  peerToPeerExposure: "High-volume peer-to-peer transaction patterns consistent with unlicensed exchange activity.",
  exchangeRisk:       "Interaction with high-risk or unregulated exchange platforms.",
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day:"2-digit", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"Asia/Dubai" }) + " (GST)";
}

function riskNarrative(scan, kyc) {
  const score = scan.overall_score ?? scan.overallScore ?? 0;
  const level = RL(score);
  const chain = scan.chain || "Unknown";
  const addr = scan.address ? scan.address.slice(0,12) + "…" + scan.address.slice(-8) : "—";
  const owner = kyc?.owner_name ? `belonging to ${kyc.owner_name}` : "";
  const entity = scan.entity || "Unhosted Wallet";
  const decision = scan.decision || "—";

  const levelText = {
    LOW: `The wallet presents a low level of risk and no significant adverse findings were identified during this screening. The on-chain transaction profile is consistent with normal activity for a ${entity.toLowerCase()}.`,
    MEDIUM: `The wallet presents a moderate risk profile. While no direct sanctions exposure was detected, certain transaction patterns warrant ongoing monitoring. Enhanced due diligence is recommended prior to accepting further transfers from this source.`,
    HIGH: `The wallet presents an elevated risk profile. One or more significant risk signals were detected during on-chain analysis. This wallet should be treated with caution and a full enhanced due diligence review is strongly recommended before proceeding with any transactions.`,
    CRITICAL: `The wallet presents a critical risk profile. Serious adverse findings were identified during screening, including potential sanctions exposure, mixer usage, or proximity to known illicit activity. Immediate escalation is required. No transactions should be accepted from this wallet until a full compliance review is completed.`,
  };

  return `This report presents the findings of an on-chain AML screening conducted by Vigilante on wallet address ${addr} (${chain} network) ${owner}. The wallet was classified as a ${entity}. The screening assigned a composite risk score of ${score}/100, placing it in the ${level} RISK category. The screening decision was: ${decision}. ${levelText[level]}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF GENERATION
// ═══════════════════════════════════════════════════════════════════════════
export async function generatePDF(scan, kyc, scanHistory, changes) {
  // Load jsPDF dynamically from CDN if not already loaded
  if (!window.jspdf) {
    await new Promise((resolve, reject) => {
      if (document.querySelector('script[data-jspdf]')) { resolve(); return; }
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.dataset.jspdf = "1";
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    // Load autotable plugin
    await new Promise((resolve, reject) => {
      if (document.querySelector('script[data-autotable]')) { resolve(); return; }
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
      s.dataset.autotable = "1";
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });

  const PW = 210; const PH = 297;
  const ML = 18; const MR = 18; const CW = PW - ML - MR;
  const score = scan.overall_score ?? scan.overallScore ?? 0;
  const level = RL(score);
  const riskColor = { LOW:[0,196,122], MEDIUM:[212,160,23], HIGH:[212,82,10], CRITICAL:[204,17,51] }[level];
  const decColor = scan.decision==="ACCEPT"?[0,196,122]:scan.decision==="REVIEW"?[212,160,23]:[204,17,51];

  let y = 0;

  // ── Helper functions ──
  const setFont = (size, style="normal", color=[30,30,30]) => {
    doc.setFontSize(size); doc.setFont("helvetica", style); doc.setTextColor(...color);
  };
  const line = (x1,y1,x2,y2,color=[200,210,220],lw=0.3) => {
    doc.setDrawColor(...color); doc.setLineWidth(lw); doc.line(x1,y1,x2,y2);
  };
  const rect = (x,y,w,h,fillColor,strokeColor=null) => {
    doc.setFillColor(...fillColor);
    if(strokeColor){ doc.setDrawColor(...strokeColor); doc.roundedRect(x,y,w,h,1,1,"FD"); }
    else doc.roundedRect(x,y,w,h,1,1,"F");
  };
  const text = (txt, x, y2, align="left") => doc.text(String(txt||"—"), x, y2, {align});
  const newPage = () => {
    doc.addPage();
    // Header strip on new pages
    doc.setFillColor(8,12,20); doc.rect(0,0,PW,12,"F");
    setFont(7,"bold",[0,184,232]); text("VIGILANTE — ON-CHAIN AML SCREENING REPORT", ML, 8);
    setFont(7,"normal",[80,100,120]);
    text(`${scan.address?.slice(0,16)}… · ${formatDate(scan.scanned_at||scan.ts)}`, PW-MR, 8, "right");
    return 20;
  };

  // ══ COVER PAGE ══════════════════════════════════════════════════════════
  // Dark header band
  doc.setFillColor(8,12,20); doc.rect(0,0,PW,72,"F");

  // Hexagon logo placeholder
  doc.setDrawColor(0,184,232); doc.setLineWidth(1);
  const hx=ML+8, hy=20, hr=10;
  const hexPoints = Array.from({length:6},(_,i)=>{const a=Math.PI/180*(60*i-30);return[hx+hr*Math.cos(a),hy+hr*Math.sin(a)]});
  doc.setFillColor(0,184,232,0.15);
  hexPoints.forEach(([px,py],i)=>{ if(i===0)doc.moveTo(px,py); else doc.lineTo(px,py); });
  doc.lines(hexPoints.map(([px,py],i)=>i===0?[0,0]:[px-hexPoints[i-1][0],py-hexPoints[i-1][1]]),hexPoints[0][0],hexPoints[0][1],"FD");

  setFont(22,"bold",[0,184,232]); text("VIGILANTE", ML+24, 24);
  setFont(8,"normal",[100,140,180]); text("ON-CHAIN AML SCREENING PLATFORM", ML+24, 30);

  setFont(14,"bold",[255,255,255]); text("Wallet Screening Report", ML, 48);
  setFont(8,"normal",[100,140,180]);
  text("CONFIDENTIAL — AML COMPLIANCE DOCUMENT", ML, 55);
  text(`Report generated: ${formatDate(new Date().toISOString())}`, ML, 61);
  text(`Reference: VIG-${Date.now().toString(36).toUpperCase()}`, ML, 67);

  // Risk verdict banner
  doc.setFillColor(...riskColor); doc.rect(0,72,PW,18,"F");
  setFont(13,"bold",[255,255,255]);
  text(`${level} RISK — SCORE ${score}/100 — ${scan.decision}`, PW/2, 84, "center");

  y = 102;

  // Wallet identity box
  rect(ML,y,CW,36,[14,22,40]);
  setFont(7,"bold",[0,184,232]); text("WALLET ADDRESS", ML+6, y+8);
  setFont(10,"normal",[200,220,255]); text(scan.address||"—", ML+6, y+15);
  setFont(7,"bold",[80,100,130]); text("CHAIN", ML+6, y+23);
  setFont(9,"normal",[180,200,230]); text(scan.chain||"—", ML+6+20, y+23);
  setFont(7,"bold",[80,100,130]); text("ENTITY", ML+60, y+23);
  setFont(9,"normal",[180,200,230]); text(scan.entity||"—", ML+80, y+23);
  setFont(7,"bold",[80,100,130]); text("BALANCE", ML+130, y+23);
  setFont(9,"normal",[180,200,230]); text(scan.balance||"—", ML+152, y+23);
  setFont(7,"bold",[80,100,130]); text("FIRST SEEN", ML+6, y+31);
  setFont(9,"normal",[180,200,230]); text(scan.first_seen||scan.firstSeen||"—", ML+35, y+31);
  setFont(7,"bold",[80,100,130]); text("TX COUNT", ML+80, y+31);
  setFont(9,"normal",[180,200,230]); text(String(scan.tx_count||scan.txCount||0), ML+104, y+31);

  y += 46;

  // KYC summary if available
  if (kyc?.owner_name || kyc?.entity_type) {
    rect(ML,y,CW,kyc.relationship_manager?30:24,[14,32,28]);
    setFont(7,"bold",[0,200,150]); text("KYC ON FILE", ML+6, y+8);
    const kycFields = [
      ["Owner", kyc.owner_name], ["Reference", kyc.wallet_reference],
      ["Entity Type", kyc.entity_type], ["Jurisdiction", kyc.jurisdiction],
      ["Int. Risk Class.", kyc.risk_classification],
    ].filter(([,v])=>v);
    let kx = ML+6;
    kycFields.forEach(([k,v],i)=>{
      if(kx > ML+140){ kx=ML+6; y+=8; }
      setFont(7,"bold",[80,160,130]); text(k, kx, y+15);
      setFont(8,"normal",[200,240,220]); text(v, kx+25, y+15);
      kx += 55;
    });
    if(kyc.relationship_manager){
      setFont(7,"bold",[80,160,130]); text("RM / Introducer", ML+6, y+23);
      setFont(8,"normal",[200,240,220]); text(kyc.relationship_manager, ML+46, y+23);
    }
    y += kyc.relationship_manager?38:32;
  }

  // Executive summary
  setFont(10,"bold",[30,60,100]); text("Executive Summary", ML, y);
  line(ML, y+2, ML+CW, y+2);
  y += 8;
  setFont(8,"normal",[50,70,90]);
  const narrative = riskNarrative(scan, kyc);
  const narLines = doc.splitTextToSize(narrative, CW);
  narLines.forEach(l => { text(l, ML, y); y += 5; });

  y += 4;

  // ══ PAGE 2: RISK SIGNALS ═════════════════════════════════════════════════
  y = newPage();
  setFont(11,"bold",[30,60,100]); text("Risk Signal Analysis", ML, y); y+=6;
  line(ML,y,ML+CW,y); y+=6;

  const signals = scan.signals || {};
  Object.entries(SIGNAL_LABELS).forEach(([key, label]) => {
    const val = Math.round(signals[key] || 0);
    const slevel = RL(val);
    const sc = { LOW:[0,196,122], MEDIUM:[212,160,23], HIGH:[212,82,10], CRITICAL:[204,17,51] }[slevel];

    if(y > 260) { y = newPage(); }

    // Signal row
    setFont(9,"bold",[40,60,80]); text(label, ML, y+5);
    setFont(8,"normal",[100,120,140]);
    const descLines = doc.splitTextToSize(SIGNAL_DESC[key], CW-50);
    descLines.forEach((dl,i) => text(dl, ML, y+11+(i*4.5)));

    // Score pill
    doc.setFillColor(...sc); doc.roundedRect(ML+CW-30, y, 30, 10, 2, 2, "F");
    setFont(9,"bold",[255,255,255]); text(`${val}/100`, ML+CW-15, y+7, "center");

    // Bar
    doc.setFillColor(220,228,238); doc.roundedRect(ML, y+14, CW-35, 3, 1, 1, "F");
    if(val>0){ doc.setFillColor(...sc); doc.roundedRect(ML, y+14, (CW-35)*(val/100), 3, 1, 1, "F"); }

    y += 26 + (descLines.length-1)*4.5;
    line(ML,y,ML+CW,y,[220,228,238],0.2); y+=4;
  });

  // ══ PAGE 3: COUNTERPARTIES ═══════════════════════════════════════════════
  y = newPage();
  setFont(11,"bold",[30,60,100]); text("Counterparty Analysis", ML, y); y+=6;
  line(ML,y,ML+CW,y); y+=6;

  const cps = (scan.counterparties||[]).filter(c=>c.address);
  if(cps.length===0){
    setFont(9,"normal",[100,120,140]); text("No counterparty data available for this scan.", ML, y); y+=10;
  } else {
    setFont(8,"normal",[60,80,100]);
    text(`${cps.length} counterpart${cps.length===1?"y":"ies"} identified across ${scan.hop_node_count||0} hop traversal nodes.`, ML, y); y+=8;

    const flagged = cps.filter(c=>c.knownRisk!==null&&c.knownRisk>25);
    if(flagged.length>0){
      setFont(9,"bold",[204,17,51]); text(`⚠ ${flagged.length} high-risk counterpart${flagged.length===1?"y":"ies"} detected`, ML, y); y+=8;
    }

    doc.autoTable({
      startY: y,
      margin: { left: ML, right: MR },
      head: [["Direction","Address","Category","Entity Label","Risk Score"]],
      body: cps.slice(0,25).map(cp=>[
        cp.hop>0?`Hop ${cp.hop}`:(cp.direction||"—"),
        (cp.address||"").slice(0,20)+"…",
        cp.cat||"UNKNOWN",
        cp.label||"Unknown",
        cp.knownRisk!==null?String(cp.knownRisk):"—",
      ]),
      styles: { fontSize:7.5, cellPadding:2.5, font:"helvetica", textColor:[40,60,80] },
      headStyles: { fillColor:[8,12,20], textColor:[0,184,232], fontStyle:"bold", fontSize:7 },
      columnStyles: { 4:{halign:"center"} },
      alternateRowStyles: { fillColor:[240,244,250] },
      didParseCell: (data) => {
        if(data.column.index===4&&data.section==="body"){
          const v=parseInt(data.cell.raw);
          if(!isNaN(v)){ if(v>=80)data.cell.styles.textColor=[204,17,51]; else if(v>=55)data.cell.styles.textColor=[212,82,10]; else if(v>=30)data.cell.styles.textColor=[212,160,23]; else data.cell.styles.textColor=[0,196,122]; data.cell.styles.fontStyle="bold"; }
        }
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ══ SCAN HISTORY (if multiple scans) ═════════════════════════════════════
  if(scanHistory && scanHistory.length > 1) {
    if(y > 230) { y = newPage(); }
    setFont(11,"bold",[30,60,100]); text("Scan History", ML, y); y+=6;
    line(ML,y,ML+CW,y); y+=6;

    doc.autoTable({
      startY: y,
      margin: { left: ML, right: MR },
      head: [["Scan Date","Score","Risk Level","Decision","Scanned By","Score Delta"]],
      body: scanHistory.slice(0,20).map(s=>[
        formatDate(s.scanned_at||s.ts),
        String(s.overall_score??s.overallScore??0),
        RL(s.overall_score??s.overallScore??0),
        s.decision||"—",
        s.scanned_by_email||"—",
        s.score_delta!==undefined?(s.score_delta>0?`+${s.score_delta}`:String(s.score_delta)):"—",
      ]),
      styles: { fontSize:7.5, cellPadding:2.5, font:"helvetica", textColor:[40,60,80] },
      headStyles: { fillColor:[8,12,20], textColor:[0,184,232], fontStyle:"bold", fontSize:7 },
      alternateRowStyles: { fillColor:[240,244,250] },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ══ CHANGE LOG ═══════════════════════════════════════════════════════════
  if(changes && changes.length > 0) {
    if(y > 230) { y = newPage(); }
    setFont(11,"bold",[30,60,100]); text("Change Log", ML, y); y+=6;
    line(ML,y,ML+CW,y); y+=6;

    doc.autoTable({
      startY: y,
      margin: { left: ML, right: MR },
      head: [["Date","Change Type","Field","From","To","Severity"]],
      body: changes.slice(0,30).map(c=>[
        formatDate(c.created_at),
        (c.change_type||"").replace(/_/g," "),
        c.field||"—",
        c.from_value||"—",
        c.to_value||"—",
        c.severity||"—",
      ]),
      styles: { fontSize:7, cellPadding:2, font:"helvetica", textColor:[40,60,80] },
      headStyles: { fillColor:[8,12,20], textColor:[0,184,232], fontStyle:"bold", fontSize:7 },
      alternateRowStyles: { fillColor:[240,244,250] },
      columnStyles: { 5:{ halign:"center" } },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ══ COMPLIANCE DECLARATION ═══════════════════════════════════════════════
  if(y > 220) { y = newPage(); }
  else { y += 4; }

  rect(ML,y,CW,64,[240,245,255],[200,215,235]);
  setFont(9,"bold",[30,60,100]); text("Compliance Declaration", ML+6, y+9);
  line(ML+6, y+12, ML+CW-6, y+12, [200,215,235], 0.3);

  const declItems = [
    ["Screening Standard", "FATF Recommendation 16 — Virtual Assets"],
    ["Policy Applied", `Accept ≤ 25 · Review ≤ 54 · Reject > 54`],
    ["Data Sources", "Blockstream Esplora · Etherscan · Tronscan · Solana RPC · OFAC SDN List"],
    ["OFAC Check", `Performed · ${OFAC_STATUS(scan)}`],
    ["Hop Traversal", `${scan.hop_node_count||0} nodes across multi-hop graph traversal`],
    ["Screened By", `${scan.scanned_by_email||"Vigilante User"} · ${formatDate(scan.scanned_at||scan.ts)}`],
    ["Report Generated", formatDate(new Date().toISOString())],
    ["Platform", "Vigilante v4.0 — On-Chain AML Screening"],
  ];

  let dy = y + 18;
  declItems.forEach(([k,v]) => {
    setFont(7.5,"bold",[60,90,130]); text(k+":", ML+6, dy);
    setFont(7.5,"normal",[40,60,80]); text(v, ML+55, dy);
    dy += 6;
  });

  y += 72;

  // Analyst notes
  const note = scan.analyst_note || scan.note;
  if(note){
    if(y > 250) y = newPage();
    setFont(9,"bold",[30,60,100]); text("Analyst Notes", ML, y); y+=6;
    line(ML,y,ML+CW,y); y+=6;
    setFont(8,"normal",[50,70,90]);
    const noteLines = doc.splitTextToSize(note, CW);
    noteLines.forEach(l => { text(l, ML, y); y+=5; });
  }

  // ══ FOOTER ON ALL PAGES ══════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages();
  for(let i=1; i<=totalPages; i++){
    doc.setPage(i);
    doc.setFillColor(8,12,20); doc.rect(0,PH-10,PW,10,"F");
    setFont(6,"normal",[60,90,120]);
    text("CONFIDENTIAL — This report is generated by Vigilante AML Screening. For compliance use only. Not legal advice.", ML, PH-4);
    text(`Page ${i} of ${totalPages}`, PW-MR, PH-4, "right");
  }

  return doc.output("arraybuffer");
}

function OFAC_STATUS(scan){
  const score = scan.overall_score ?? scan.overallScore ?? 0;
  const sigs = scan.signals || {};
  if((sigs.sanctionsExposure||0) > 50) return "SANCTIONS EXPOSURE DETECTED";
  if(scan.direct_match) return "DIRECT DATABASE MATCH";
  return "No direct sanctions match identified";
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCX GENERATION
// ═══════════════════════════════════════════════════════════════════════════
export async function generateDOCX(scan, kyc, scanHistory, changes) {
  const score = scan.overall_score ?? scan.overallScore ?? 0;
  const level = RL(score);
  const riskHex = RL_COLOR[level];

  const heading = (text, level2=1) => new Paragraph({
    text, heading: level2===1?HeadingLevel.HEADING_1:level2===2?HeadingLevel.HEADING_2:HeadingLevel.HEADING_3,
    spacing: { before:240, after:80 },
    ...(level2===1?{border:{bottom:{style:BorderStyle.SINGLE,size:4,color:"2E75B6"}}}:{}),
  });

  const para = (text2, opts={}) => new Paragraph({
    children:[new TextRun({text:text2,size:20,color:"404040",...opts})],
    spacing:{after:120},
  });

  const kv = (key, value, keyColor="2E75B6") => new Paragraph({
    children:[
      new TextRun({text:key+": ",bold:true,size:20,color:keyColor}),
      new TextRun({text:String(value||"—"),size:20,color:"404040"}),
    ],
    spacing:{after:80},
  });

  const tableRow = (cells, isHeader=false) => new TableRow({
    children: cells.map((cell,i) => new TableCell({
      children:[new Paragraph({children:[new TextRun({text:String(cell||"—"),size:18,bold:isHeader,color:isHeader?"FFFFFF":"303030"})],spacing:{after:0}})],
      shading: isHeader?{fill:"08080F",type:ShadingType.SOLID}:{fill:i%2===0?"FFFFFF":"F0F4FA",type:ShadingType.SOLID},
      margins:{top:60,bottom:60,left:80,right:80},
    })),
  });

  const sections_content = [];

  // ── Cover info ──
  sections_content.push(
    new Paragraph({
      children:[new TextRun({text:"VIGILANTE",bold:true,size:52,color:"0099CC"})],
      spacing:{after:40},
    }),
    new Paragraph({
      children:[new TextRun({text:"On-Chain AML Screening Report",bold:true,size:32,color:"1E3A5F"})],
      spacing:{after:40},
    }),
    new Paragraph({
      children:[new TextRun({text:"CONFIDENTIAL — AML Compliance Document",size:18,color:"808080",italics:true})],
      spacing:{after:200},
    }),
    new Paragraph({
      children:[
        new TextRun({text:"Risk Decision: ",bold:true,size:28,color:"1E3A5F"}),
        new TextRun({text:`${level} RISK — SCORE ${score}/100 — ${scan.decision}`,bold:true,size:28,color:riskHex}),
      ],
      spacing:{after:200},
    }),
  );

  // ── Wallet identity ──
  sections_content.push(heading("Wallet Details"));
  sections_content.push(kv("Address", scan.address));
  sections_content.push(kv("Chain", scan.chain));
  sections_content.push(kv("Entity Classification", scan.entity));
  sections_content.push(kv("Balance", scan.balance));
  sections_content.push(kv("Transaction Count", String(scan.tx_count||scan.txCount||0)));
  sections_content.push(kv("First Seen", scan.first_seen||scan.firstSeen||"—"));
  sections_content.push(kv("Scan Date", formatDate(scan.scanned_at||scan.ts)));
  sections_content.push(kv("Screened By", scan.scanned_by_email||"—"));

  // ── KYC ──
  if(kyc?.owner_name||kyc?.entity_type){
    sections_content.push(heading("KYC Information"));
    [["Owner Name",kyc.owner_name],["Wallet Reference",kyc.wallet_reference],["Entity Type",kyc.entity_type],["Jurisdiction",kyc.jurisdiction],["ID Reference",kyc.id_reference],["Relationship Manager",kyc.relationship_manager],["Internal Risk Classification",kyc.risk_classification],["Contact Number",kyc.contact_number],["Contact Email",kyc.contact_email]].filter(([,v])=>v).forEach(([k,v])=>sections_content.push(kv(k,v)));
    if(kyc.notes) sections_content.push(para(kyc.notes,{italics:true,color:"606060"}));
  }

  // ── Executive summary ──
  sections_content.push(heading("Executive Summary"));
  sections_content.push(para(riskNarrative(scan, kyc)));

  // ── Risk signals ──
  sections_content.push(heading("Risk Signal Breakdown"));
  sections_content.push(
    new Table({
      width:{size:100,type:WidthType.PERCENTAGE},
      rows:[
        tableRow(["Signal","Score","Level","Description"],true),
        ...Object.entries(SIGNAL_LABELS).map(([key,label])=>{
          const val=Math.round((scan.signals||{})[key]||0);
          return tableRow([label,`${val}/100`,RL(val),SIGNAL_DESC[key]]);
        }),
      ],
    })
  );

  // ── Counterparties ──
  sections_content.push(heading("Counterparty Analysis"));
  const cps=(scan.counterparties||[]).filter(c=>c.address);
  if(cps.length===0){
    sections_content.push(para("No counterparty data available for this scan."));
  } else {
    sections_content.push(para(`${cps.length} counterparties identified. Hop nodes: ${scan.hop_node_count||0}.`));
    sections_content.push(
      new Table({
        width:{size:100,type:WidthType.PERCENTAGE},
        rows:[
          tableRow(["Direction","Address","Category","Label","Risk"],true),
          ...cps.slice(0,30).map(cp=>tableRow([
            cp.hop>0?`Hop ${cp.hop}`:(cp.direction||"—"),
            (cp.address||"").slice(0,22)+"…",
            cp.cat||"—",
            cp.label||"—",
            cp.knownRisk!==null?String(cp.knownRisk):"—",
          ])),
        ],
      })
    );
  }

  // ── Scan history ──
  if(scanHistory&&scanHistory.length>1){
    sections_content.push(heading("Scan History"));
    sections_content.push(
      new Table({
        width:{size:100,type:WidthType.PERCENTAGE},
        rows:[
          tableRow(["Date","Score","Risk","Decision","By","Delta"],true),
          ...scanHistory.slice(0,20).map(s=>tableRow([
            formatDate(s.scanned_at||s.ts),
            String(s.overall_score??0),
            RL(s.overall_score??0),
            s.decision||"—",
            s.scanned_by_email||"—",
            s.score_delta!==undefined?(s.score_delta>0?`+${s.score_delta}`:String(s.score_delta)):"—",
          ])),
        ],
      })
    );
  }

  // ── Change log ──
  if(changes&&changes.length>0){
    sections_content.push(heading("Change Log"));
    sections_content.push(
      new Table({
        width:{size:100,type:WidthType.PERCENTAGE},
        rows:[
          tableRow(["Date","Type","Field","From","To","Severity"],true),
          ...changes.slice(0,30).map(c=>tableRow([
            formatDate(c.created_at),
            (c.change_type||"").replace(/_/g," "),
            c.field||"—",c.from_value||"—",c.to_value||"—",c.severity||"—",
          ])),
        ],
      })
    );
  }

  // ── Analyst notes ──
  const note = scan.analyst_note||scan.note;
  if(note){
    sections_content.push(heading("Analyst Notes"));
    sections_content.push(para(note,{italics:true}));
  }

  // ── Compliance declaration ──
  sections_content.push(heading("Compliance Declaration"));
  [
    ["Screening Standard","FATF Recommendation 16 — Virtual Assets"],
    ["Policy Applied","Accept ≤ 25 · Review ≤ 54 · Reject > 54"],
    ["Data Sources","Blockstream Esplora · Etherscan · Tronscan · Solana RPC · OFAC SDN"],
    ["OFAC Check",`Performed · ${OFAC_STATUS(scan)}`],
    ["Hop Traversal",`${scan.hop_node_count||0} nodes traversed`],
    ["Screened By",`${scan.scanned_by_email||"Vigilante User"} · ${formatDate(scan.scanned_at||scan.ts)}`],
    ["Report Generated",formatDate(new Date().toISOString())],
    ["Platform","Vigilante v4.0 — On-Chain AML Screening"],
  ].forEach(([k,v])=>sections_content.push(kv(k,v)));

  sections_content.push(new Paragraph({spacing:{before:400}}));
  sections_content.push(new Paragraph({
    children:[new TextRun({text:"CONFIDENTIAL — This report is generated by Vigilante AML Screening. For compliance use only. Not legal advice.",size:16,italics:true,color:"808080"})],
  }));

  const docx = new Document({
    creator:"Vigilante AML Screening",
    title:`Wallet Screening Report — ${scan.address?.slice(0,16)}`,
    description:"On-chain AML compliance report",
    styles:{
      default:{
        document:{run:{font:"Calibri",size:20}},
        heading1:{run:{font:"Calibri",bold:true,size:28,color:"1E3A5F"}},
        heading2:{run:{font:"Calibri",bold:true,size:24,color:"2E5A8F"}},
      },
    },
    sections:[{
      headers:{default:new Header({children:[new Paragraph({children:[new TextRun({text:"Vigilante — On-Chain AML Screening Report  |  CONFIDENTIAL",size:16,color:"808080",italics:true})]})]})},
      footers:{default:new Footer({children:[new Paragraph({children:[new TextRun({text:"Page ",size:16,color:"808080"}),new PageNumber({}),new TextRun({text:"  |  Vigilante AML Screening  |  Confidential",size:16,color:"808080"})],alignment:AlignmentType.CENTER})]})},
      children:sections_content,
    }],
  });

  return await Packer.toBuffer(docx);
}

// ─── Download helpers ────────────────────────────────────────────────────────
export function downloadBlob(data, filename, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function reportFilename(scan, ext) {
  const addr = (scan.address||"unknown").slice(0,10);
  const date = new Date(scan.scanned_at||scan.ts||Date.now()).toISOString().slice(0,10);
  return `vigilante-report_${addr}_${date}.${ext}`;
}
