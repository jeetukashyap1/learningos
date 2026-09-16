"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export function InfoPage({ eyebrow, title, description, bullets }: { eyebrow: string; title: string; description: string; bullets: string[] }) { return <main className="container"><div style={{maxWidth:900,margin:"30px auto"}}><div className="eyebrow">{eyebrow}</div><h1 style={{marginTop:14,maxWidth:700}}>{title}</h1><p className="muted" style={{fontSize:16,lineHeight:1.8,maxWidth:680,marginTop:18}}>{description}</p><div className="grid grid-3" style={{marginTop:34}}>{bullets.map((bullet)=><div className="card pad" key={bullet}><CheckCircle2 size={18} color="var(--orange)"/><p style={{fontSize:13,lineHeight:1.6,marginTop:16}}>{bullet}</p></div>)}</div><Link href="/signup" className="btn btn-primary" style={{marginTop:32}}>Start learning <ArrowRight size={14}/></Link></div></main>; }

