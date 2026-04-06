// src/reportGenerator.js
// Generates PDF and DOCX compliance reports from Vigilante scan data

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType,
} from "docx";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const RL = s => s <= 25 ? "LOW" : s <= 54 ? "MEDIUM" : s <= 74 ? "HIGH" : "CRITICAL";
const RL_HEX  = { LOW:"00C47A", MEDIUM:"D4A017", HIGH:"D4520A", CRITICAL:"CC1133" };
const RL_RGB  = { LOW:[0,196,122], MEDIUM:[212,160,23], HIGH:[212,82,10], CRITICAL:[204,17,51] };

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

function fmt(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day:"2-digit", month:"long", year:"numeric",
      hour:"2-digit", minute:"2-digit",
    }) + " (GST)";
  } catch { return String(iso).slice(0,16); }
}

function ofacStatus(scan) {
  if ((scan.signals?.sanctionsExposure || 0) > 50) return "Sanctions exposure detected";
  if (scan.direct_match) return "Direct database match identified";
  return "No direct sanctions match identified";
}

function narrative(scan, kyc) {
  const score = scan.overall_score ?? scan.overallScore ?? 0;
  const level = RL(score);
  const addr  = (scan.address||"").slice(0,12) + "…" + (scan.address||"").slice(-8);
  const owner = kyc?.owner_name ? `, belonging to ${kyc.owner_name},` : "";
  const entity = scan.entity || "Unhosted Wallet";
  const decision = scan.decision || "—";

  const body = {
    LOW:      `No significant adverse findings were identified. The on-chain transaction profile is consistent with normal activity for a ${entity.toLowerCase()}.`,
    MEDIUM:   `A moderate risk profile was observed. While no direct sanctions exposure was detected, certain patterns warrant ongoing monitoring. Enhanced due diligence is recommended.`,
    HIGH:     `An elevated risk profile was identified. One or more significant risk signals were detected. A full enhanced due diligence review is strongly recommended before proceeding.`,
    CRITICAL: `Critical adverse findings were identified, including potential sanctions exposure or proximity to illicit activity. Immediate escalation is required. No transactions should be accepted until a full compliance review is completed.`,
  }[level];

  return `This report presents the findings of an on-chain AML screening conducted by Vigilante on wallet address ${addr} (${scan.chain||"Unknown"} network)${owner} classified as a ${entity}. The composite risk score is ${score}/100 — ${level} RISK. The screening decision was: ${decision}. ${body}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF
// ═══════════════════════════════════════════════════════════════════════════
export async function generatePDF(scan, kyc, scanHistory, changes) {
  const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });

  const PW=210, PH=297, ML=18, MR=18, CW=PW-ML-MR;
  const score  = scan.overall_score ?? scan.overallScore ?? 0;
  const level  = RL(score);
  const riskRGB = RL_RGB[level];
  const decRGB  = scan.decision==="ACCEPT"?[0,196,122]:scan.decision==="REVIEW"?[212,160,23]:[204,17,51];

  let y = 0;

  // ── Utilities ──
  const sf = (size, style="normal", rgb=[40,60,80]) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
    doc.setTextColor(...rgb);
  };
  const ln = (x1,y1,x2,y2,rgb=[200,215,230],lw=0.3) => {
    doc.setDrawColor(...rgb); doc.setLineWidth(lw); doc.line(x1,y1,x2,y2);
  };
  const box = (x,bY,w,h,fill,stroke=null,r=1) => {
    doc.setFillColor(...fill);
    if (stroke) { doc.setDrawColor(...stroke); doc.roundedRect(x,bY,w,h,r,r,"FD"); }
    else doc.roundedRect(x,bY,w,h,r,r,"F");
  };
  const tx = (t,x,tY,align="left") => doc.text(String(t??"—"),x,tY,{align});

  const pageHeader = () => {
    doc.setFillColor(8,12,20);
    doc.rect(0,0,PW,11,"F");
    sf(7,"bold",[0,184,232]); tx("VIGILANTE — AML SCREENING REPORT",ML,7.5);
    sf(6,"normal",[70,100,130]);
    tx(`${(scan.address||"").slice(0,18)}… · ${fmt(scan.scanned_at||scan.ts)}`, PW-MR, 7.5, "right");
    return 18;
  };

  const newPage = () => { doc.addPage(); return pageHeader(); };

  // ══ COVER ══════════════════════════════════════════════════════════════
  doc.setFillColor(8,12,20); doc.rect(0,0,PW,65,"F");

  // Logo circle
  doc.setFillColor(0,60,90);   doc.circle(ML+9, 18, 8, "F");
  doc.setFillColor(0,184,232); doc.circle(ML+9, 18, 5, "F");
  doc.setFillColor(8,12,20);   doc.circle(ML+9, 18, 2, "F");

  sf(20,"bold",[0,184,232]); tx("VIGILANTE", ML+22, 16);
  sf(8,"normal",[80,130,180]); tx("ON-CHAIN AML SCREENING PLATFORM", ML+22, 22);

  sf(13,"bold",[255,255,255]); tx("Wallet Screening Report", ML, 38);
  sf(8,"normal",[100,140,180]);
  tx("CONFIDENTIAL — AML Compliance Document", ML, 45);
  tx(`Generated: ${fmt(new Date().toISOString())}`, ML, 51);
  tx(`Reference: VIG-${Date.now().toString(36).toUpperCase()}`, ML, 57);

  // Risk banner
  doc.setFillColor(...riskRGB); doc.rect(0,65,PW,16,"F");
  sf(11,"bold",[255,255,255]);
  tx(`${level} RISK  ·  SCORE ${score}/100  ·  ${scan.decision||"—"}`, PW/2, 76, "center");

  y = 92;

  // Wallet box
  box(ML,y,CW,34,[14,22,42]);
  sf(7,"bold",[0,184,232]);   tx("WALLET ADDRESS", ML+5, y+7);
  sf(9,"normal",[200,225,255]); tx(scan.address||"—", ML+5, y+14);
  const meta1 = [["CHAIN",scan.chain],["ENTITY",scan.entity],["BALANCE",scan.balance]];
  meta1.forEach(([k,v],i)=>{
    sf(7,"bold",[80,110,140]);   tx(k, ML+5+i*60, y+22);
    sf(8,"normal",[180,205,230]); tx(v||"—", ML+5+i*60, y+28);
  });
  const meta2 = [["TX COUNT",String(scan.tx_count||scan.txCount||0)],["FIRST SEEN",scan.first_seen||scan.firstSeen||"—"],["SCANNED BY",scan.scanned_by_email||"—"]];
  meta2.forEach(([k,v],i)=>{
    sf(7,"bold",[80,110,140]);   tx(k, ML+5+i*60, y+34);
    sf(8,"normal",[180,205,230]); tx(v, ML+5+i*60, y+39);
  });

  y += 44;

  // KYC box
  if (kyc?.owner_name || kyc?.entity_type) {
    const kycRows = [["Owner",kyc.owner_name],["Reference",kyc.wallet_reference],["Entity",kyc.entity_type],["Jurisdiction",kyc.jurisdiction],["Int. Risk",kyc.risk_classification],["RM",kyc.relationship_manager]].filter(([,v])=>v);
    const kycH = 12 + Math.ceil(kycRows.length/3)*8;
    box(ML,y,CW,kycH,[10,38,28]);
    sf(7,"bold",[0,200,150]); tx("KYC ON FILE", ML+5, y+7);
    kycRows.forEach(([k,v],i)=>{
      const col=i%3, row=Math.floor(i/3);
      sf(7,"bold",[60,160,120]);   tx(k+":", ML+5+col*58, y+14+row*7);
      sf(7,"normal",[180,230,210]); tx(String(v).slice(0,22), ML+22+col*58, y+14+row*7);
    });
    y += kycH + 6;
  }

  // Executive summary
  sf(10,"bold",[30,60,100]); tx("Executive Summary", ML, y); y+=4;
  ln(ML,y,ML+CW,y); y+=5;
  sf(8,"normal",[50,70,90]);
  doc.splitTextToSize(narrative(scan,kyc), CW).forEach(l=>{ tx(l,ML,y); y+=5; });

  y += 4;

  // ══ SIGNALS PAGE ══════════════════════════════════════════════════════
  y = newPage();
  sf(10,"bold",[30,60,100]); tx("Risk Signal Analysis", ML, y); y+=4;
  ln(ML,y,ML+CW,y); y+=6;

  Object.entries(SIGNAL_LABELS).forEach(([key,label])=>{
    const val = Math.round((scan.signals||{})[key]||0);
    const sRGB = RL_RGB[RL(val)];
    if (y > 262) { y = newPage(); }

    sf(9,"bold",[40,65,90]);  tx(label, ML, y+5);
    // Score pill
    doc.setFillColor(...sRGB); doc.roundedRect(ML+CW-28,y,28,9,2,2,"F");
    sf(8,"bold",[255,255,255]); tx(`${val}/100`, ML+CW-14, y+6.5, "center");
    // Description
    sf(7.5,"normal",[90,115,140]);
    const dLines = doc.splitTextToSize(SIGNAL_DESC[key], CW-34);
    dLines.forEach((dl,i)=>tx(dl, ML, y+11+(i*4.5)));
    // Bar track
    doc.setFillColor(215,225,238); doc.roundedRect(ML,y+13+dLines.length*4.5,CW-34,3,1,1,"F");
    if(val>0){ doc.setFillColor(...sRGB); doc.roundedRect(ML,y+13+dLines.length*4.5,(CW-34)*(val/100),3,1,1,"F"); }

    y += 20 + dLines.length*4.5;
    ln(ML,y,ML+CW,y,[220,230,240],0.2); y+=4;
  });

  // ══ COUNTERPARTIES PAGE ═══════════════════════════════════════════════
  y = newPage();
  sf(10,"bold",[30,60,100]); tx("Counterparty Analysis", ML, y); y+=4;
  ln(ML,y,ML+CW,y); y+=5;

  const cps = (scan.counterparties||[]).filter(c=>c.address);
  if (!cps.length) {
    sf(8,"normal",[100,120,140]); tx("No counterparty data available.", ML, y); y+=10;
  } else {
    sf(8,"normal",[60,85,110]);
    tx(`${cps.length} counterparties identified · ${scan.hop_node_count||0} hop traversal nodes`, ML, y); y+=6;
    const flagged = cps.filter(c=>c.knownRisk!==null&&c.knownRisk>25);
    if (flagged.length) {
      sf(8,"bold",[204,17,51]); tx(`⚠  ${flagged.length} high-risk counterpart${flagged.length===1?"y":"ies"} detected`, ML, y); y+=7;
    }

    autoTable(doc, {
      startY: y, margin:{left:ML,right:MR},
      head: [["Dir","Address","Category","Label","Risk"]],
      body: cps.slice(0,30).map(cp=>[
        cp.hop>0?`H${cp.hop}`:(cp.direction||"—"),
        (cp.address||"").slice(0,22)+"…",
        cp.cat||"UNKNOWN",
        (cp.label||"Unknown").slice(0,28),
        cp.knownRisk!==null?String(cp.knownRisk):"—",
      ]),
      styles:{fontSize:7.5,cellPadding:2.5,textColor:[40,60,80]},
      headStyles:{fillColor:[8,12,20],textColor:[0,184,232],fontStyle:"bold",fontSize:7},
      columnStyles:{0:{cellWidth:14},4:{halign:"center",cellWidth:16}},
      alternateRowStyles:{fillColor:[242,246,252]},
      didParseCell(data){
        if(data.column.index===4&&data.section==="body"){
          const v=parseInt(data.cell.raw);
          if(!isNaN(v)){
            data.cell.styles.fontStyle="bold";
            if(v>=80) data.cell.styles.textColor=[204,17,51];
            else if(v>=55) data.cell.styles.textColor=[212,82,10];
            else if(v>=30) data.cell.styles.textColor=[212,160,23];
            else data.cell.styles.textColor=[0,196,122];
          }
        }
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ══ SCAN HISTORY ══════════════════════════════════════════════════════
  if (scanHistory?.length > 1) {
    if (y > 230) y = newPage();
    sf(10,"bold",[30,60,100]); tx("Scan History", ML, y); y+=4;
    ln(ML,y,ML+CW,y); y+=4;

    autoTable(doc, {
      startY: y, margin:{left:ML,right:MR},
      head: [["Date","Score","Risk","Decision","By","Δ Score"]],
      body: scanHistory.slice(0,20).map(s=>[
        fmt(s.scanned_at||s.ts),
        String(s.overall_score??s.overallScore??0),
        RL(s.overall_score??s.overallScore??0),
        s.decision||"—",
        s.scanned_by_email||"—",
        s.score_delta!==undefined?(s.score_delta>0?`+${s.score_delta}`:String(s.score_delta)):"—",
      ]),
      styles:{fontSize:7.5,cellPadding:2.5,textColor:[40,60,80]},
      headStyles:{fillColor:[8,12,20],textColor:[0,184,232],fontStyle:"bold",fontSize:7},
      alternateRowStyles:{fillColor:[242,246,252]},
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ══ CHANGE LOG ════════════════════════════════════════════════════════
  if (changes?.length > 0) {
    if (y > 230) y = newPage();
    sf(10,"bold",[30,60,100]); tx("Change Log", ML, y); y+=4;
    ln(ML,y,ML+CW,y); y+=4;

    autoTable(doc, {
      startY: y, margin:{left:ML,right:MR},
      head: [["Date","Type","Field","From","To","Severity"]],
      body: changes.slice(0,30).map(c=>[
        fmt(c.created_at),
        (c.change_type||"").replace(/_/g," "),
        c.field||"—", c.from_value||"—", c.to_value||"—", c.severity||"—",
      ]),
      styles:{fontSize:7,cellPadding:2,textColor:[40,60,80]},
      headStyles:{fillColor:[8,12,20],textColor:[0,184,232],fontStyle:"bold",fontSize:7},
      alternateRowStyles:{fillColor:[242,246,252]},
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ══ ANALYST NOTES ════════════════════════════════════════════════════
  const note = scan.analyst_note||scan.note;
  if (note) {
    if (y > 250) y = newPage();
    sf(10,"bold",[30,60,100]); tx("Analyst Notes", ML, y); y+=4;
    ln(ML,y,ML+CW,y); y+=5;
    sf(8,"normal",[50,70,90]);
    doc.splitTextToSize(note, CW).forEach(l=>{ tx(l,ML,y); y+=5; });
    y+=4;
  }

  // ══ COMPLIANCE DECLARATION ════════════════════════════════════════════
  if (y > 210) y = newPage();
  else y += 4;

  box(ML,y,CW,60,[238,244,254],[195,212,238]);
  sf(9,"bold",[30,60,100]); tx("Compliance Declaration", ML+5, y+9);
  ln(ML+5,y+12,ML+CW-5,y+12,[200,215,235],0.3);

  const decl = [
    ["Screening Standard", "FATF Recommendation 16 — Virtual Assets"],
    ["Policy Thresholds",  "Accept ≤ 25  ·  Review ≤ 54  ·  Reject > 54"],
    ["Data Sources",       "Blockstream Esplora · Etherscan · Tronscan · Solana RPC"],
    ["OFAC Check",         `Performed · ${ofacStatus(scan)}`],
    ["Hop Traversal",      `${scan.hop_node_count||0} nodes across multi-hop graph analysis`],
    ["Screened By",        `${scan.scanned_by_email||"Vigilante User"}  ·  ${fmt(scan.scanned_at||scan.ts)}`],
    ["Report Generated",   fmt(new Date().toISOString())],
    ["Platform",           "Vigilante v4.0 — On-Chain AML Screening"],
  ];

  let dy = y+18;
  decl.forEach(([k,v])=>{
    sf(7.5,"bold",[55,90,140]);   tx(k+":", ML+5, dy);
    sf(7.5,"normal",[40,60,80]);  tx(v, ML+52, dy);
    dy+=6;
  });

  // ══ FOOTER ALL PAGES ══════════════════════════════════════════════════
  const total = doc.internal.getNumberOfPages();
  for (let i=1;i<=total;i++){
    doc.setPage(i);
    doc.setFillColor(8,12,20); doc.rect(0,PH-9,PW,9,"F");
    sf(6,"normal",[60,90,120]);
    tx("CONFIDENTIAL — Vigilante AML Screening. For compliance use only. Not legal advice.", ML, PH-3.5);
    tx(`Page ${i} of ${total}`, PW-MR, PH-3.5, "right");
  }

  return doc.output("arraybuffer");
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCX
// ═══════════════════════════════════════════════════════════════════════════
export async function generateDOCX(scan, kyc, scanHistory, changes) {
  const score = scan.overall_score ?? scan.overallScore ?? 0;
  const level = RL(score);
  const hex   = RL_HEX[level];

  const h1 = (text) => new Paragraph({
    text, heading: HeadingLevel.HEADING_1,
    spacing:{before:280,after:80},
    border:{bottom:{style:BorderStyle.SINGLE,size:4,color:"2E75B6"}},
  });

  const h2 = (text) => new Paragraph({
    text, heading: HeadingLevel.HEADING_2,
    spacing:{before:200,after:60},
  });

  const p = (text2, opts={}) => new Paragraph({
    children:[new TextRun({text:text2,size:20,color:"404040",...opts})],
    spacing:{after:100},
  });

  const kv = (key, value, c="2E75B6") => new Paragraph({
    children:[
      new TextRun({text:key+": ",bold:true,size:20,color:c}),
      new TextRun({text:String(value||"—"),size:20,color:"303030"}),
    ],
    spacing:{after:80},
  });

  const tRow = (cells, isHead=false) => new TableRow({
    children: cells.map((cell,i)=>new TableCell({
      children:[new Paragraph({
        children:[new TextRun({text:String(cell??"—"),size:18,bold:isHead,color:isHead?"FFFFFF":"303030"})],
        spacing:{after:0},
      })],
      shading: isHead
        ? {fill:"08080F",type:ShadingType.SOLID}
        : {fill:i%2===0?"FFFFFF":"F0F4FA",type:ShadingType.SOLID},
      margins:{top:55,bottom:55,left:90,right:90},
    })),
  });

  const children = [];

  // Cover
  children.push(
    new Paragraph({children:[new TextRun({text:"VIGILANTE",bold:true,size:56,color:"0099CC"})],spacing:{after:40}}),
    new Paragraph({children:[new TextRun({text:"On-Chain AML Screening Report",bold:true,size:34,color:"1E3A5F"})],spacing:{after:40}}),
    new Paragraph({children:[new TextRun({text:"CONFIDENTIAL — AML Compliance Document",size:18,color:"808080",italics:true})],spacing:{after:160}}),
    new Paragraph({children:[new TextRun({text:`Risk Decision: `,bold:true,size:26,color:"1E3A5F"}),new TextRun({text:`${level} RISK — ${score}/100 — ${scan.decision||"—"}`,bold:true,size:26,color:hex})],spacing:{after:200}}),
  );

  // Wallet details
  children.push(h1("Wallet Details"));
  [["Address",scan.address],["Chain",scan.chain],["Entity",scan.entity],["Balance",scan.balance],["Transaction Count",String(scan.tx_count||scan.txCount||0)],["First Seen",scan.first_seen||scan.firstSeen||"—"],["Scan Date",fmt(scan.scanned_at||scan.ts)],["Scanned By",scan.scanned_by_email||"—"]].forEach(([k,v])=>children.push(kv(k,v)));

  // KYC
  if (kyc?.owner_name||kyc?.entity_type) {
    children.push(h1("KYC Information"));
    [["Owner Name",kyc.owner_name],["Wallet Reference",kyc.wallet_reference],["Entity Type",kyc.entity_type],["Jurisdiction",kyc.jurisdiction],["ID Reference",kyc.id_reference],["Relationship Manager",kyc.relationship_manager],["Internal Risk Classification",kyc.risk_classification],["Contact Number",kyc.contact_number],["Contact Email",kyc.contact_email]].filter(([,v])=>v).forEach(([k,v])=>children.push(kv(k,v)));
    if(kyc.notes) children.push(p(kyc.notes,{italics:true,color:"606060"}));
  }

  // Executive summary
  children.push(h1("Executive Summary"), p(narrative(scan,kyc)));

  // Signals
  children.push(h1("Risk Signal Breakdown"));
  children.push(new Table({
    width:{size:100,type:WidthType.PERCENTAGE},
    rows:[
      tRow(["Signal","Score","Level","Description"],true),
      ...Object.entries(SIGNAL_LABELS).map(([key,label])=>{
        const val=Math.round((scan.signals||{})[key]||0);
        return tRow([label,`${val}/100`,RL(val),SIGNAL_DESC[key]]);
      }),
    ],
  }));

  // Counterparties
  children.push(h1("Counterparty Analysis"));
  const cps=(scan.counterparties||[]).filter(c=>c.address);
  if(!cps.length){
    children.push(p("No counterparty data available."));
  } else {
    children.push(p(`${cps.length} counterparties identified · ${scan.hop_node_count||0} hop traversal nodes.`));
    children.push(new Table({
      width:{size:100,type:WidthType.PERCENTAGE},
      rows:[
        tRow(["Dir","Address","Category","Label","Risk"],true),
        ...cps.slice(0,30).map(cp=>tRow([
          cp.hop>0?`Hop ${cp.hop}`:(cp.direction||"—"),
          (cp.address||"").slice(0,24)+"…",
          cp.cat||"—",
          (cp.label||"Unknown").slice(0,30),
          cp.knownRisk!==null?String(cp.knownRisk):"—",
        ])),
      ],
    }));
  }

  // Scan history
  if(scanHistory?.length>1){
    children.push(h1("Scan History"));
    children.push(new Table({
      width:{size:100,type:WidthType.PERCENTAGE},
      rows:[
        tRow(["Date","Score","Risk","Decision","Screened By","Δ Score"],true),
        ...scanHistory.slice(0,20).map(s=>tRow([
          fmt(s.scanned_at||s.ts),
          String(s.overall_score??0),
          RL(s.overall_score??0),
          s.decision||"—",
          s.scanned_by_email||"—",
          s.score_delta!==undefined?(s.score_delta>0?`+${s.score_delta}`:String(s.score_delta)):"—",
        ])),
      ],
    }));
  }

  // Change log
  if(changes?.length>0){
    children.push(h1("Change Log"));
    children.push(new Table({
      width:{size:100,type:WidthType.PERCENTAGE},
      rows:[
        tRow(["Date","Type","Field","From","To","Severity"],true),
        ...changes.slice(0,30).map(c=>tRow([
          fmt(c.created_at),
          (c.change_type||"").replace(/_/g," "),
          c.field||"—",c.from_value||"—",c.to_value||"—",c.severity||"—",
        ])),
      ],
    }));
  }

  // Analyst notes
  const note=scan.analyst_note||scan.note;
  if(note){ children.push(h1("Analyst Notes"),p(note,{italics:true})); }

  // Compliance declaration
  children.push(h1("Compliance Declaration"));
  [
    ["Screening Standard","FATF Recommendation 16 — Virtual Assets"],
    ["Policy Thresholds","Accept ≤ 25  ·  Review ≤ 54  ·  Reject > 54"],
    ["Data Sources","Blockstream Esplora · Etherscan · Tronscan · Solana RPC · OFAC SDN"],
    ["OFAC Check",`Performed · ${ofacStatus(scan)}`],
    ["Hop Traversal",`${scan.hop_node_count||0} nodes traversed`],
    ["Screened By",`${scan.scanned_by_email||"Vigilante User"}  ·  ${fmt(scan.scanned_at||scan.ts)}`],
    ["Report Generated",fmt(new Date().toISOString())],
    ["Platform","Vigilante v4.0 — On-Chain AML Screening"],
  ].forEach(([k,v])=>children.push(kv(k,v)));

  children.push(
    new Paragraph({spacing:{before:400}}),
    new Paragraph({children:[new TextRun({text:"CONFIDENTIAL — This report is generated by Vigilante AML Screening. For compliance use only. Not legal advice.",size:16,italics:true,color:"808080"})]}),
  );

  const docx = new Document({
    creator:"Vigilante AML Screening",
    title:`Wallet Screening Report — ${(scan.address||"").slice(0,16)}`,
    sections:[{
      headers:{default:new Header({children:[new Paragraph({children:[new TextRun({text:"Vigilante — On-Chain AML Screening Report  |  CONFIDENTIAL",size:16,color:"808080",italics:true})]})]})},
      footers:{default:new Footer({children:[new Paragraph({children:[new TextRun({text:"Vigilante AML Screening  |  Confidential  |  For compliance use only",size:16,color:"808080",italics:true})],alignment:AlignmentType.CENTER})]})},
      children,
    }],
  });

  return Packer.toBlob(docx);
}

// ─── Download helpers ────────────────────────────────────────────────────────
export function downloadBlob(data, filename, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], {type:mime});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href=url; a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 3000);
}

export function reportFilename(scan, ext) {
  const addr = (scan.address||"unknown").slice(0,10);
  const date = new Date(scan.scanned_at||scan.ts||Date.now()).toISOString().slice(0,10);
  return `vigilante-report_${addr}_${date}.${ext}`;
}
