/*
 * VEKTORIRALLI — PARANNETUT AUTOT
 * =================================
 * Mallien lähtökohta: käyttäjän alkuperäinen JSON sekä Presentation4.pdf:n
 * referenssipiirrokset. Tämä on oikeaa 3D-kärkipistegeometriaa, ei kuva.
 *
 * Rajapinta pysyy muuten ennallaan; uudessa lisäkentässä lasipinnat.
 * Huom: pelin renderöijän täytyy osata piirtää täytetyt lasidecalit.
 * Rajapinta: {formaatti, autot:[{nimi,kuvaus,
 * ominaisuudet,osat:[{tone,points,dec}],renkaat:[...],lasipinnat:[...]}]}.
 * Yksikkö dm. x=leveys, y=korkeus, z=keula (+z).
 *
 * Jokainen osat[].points muodostaa yhden KUPERAN polyedrin; kaaret syntyvät
 * useasta osasta. Jokainen lopullinen kärkipiste lasketaan pisterajaan.
 * Koristeviivat ovat erillisiä viivoja, eivät lisämesh-pisteitä.
 *
 * Käyttö selaimessa: <script src="ajoneuvot_parannetut.js"></script>
 *    window.VEKTORIRALLI_AUTOT.autot
 * Node/CommonJS: const autot = require('./ajoneuvot_parannetut.js');
 */
(function (root) {
  'use strict';

  const part = (tone, points, dec = []) => ({tone, points, dec});

  // Neljä kärkipistettä yhtä poikkileikkausta kohti. Koko kappale on kupera
  // kuori: ei n-goneja, Bezier-kuoria eikä koveria monitahokkaita.
  function loft(tone, sections, dec = []) {
    const points = sections.flatMap(([z, wb, yb, wt, yt]) => [
      [-wb, yb, z], [wb, yb, z], [-wt, yt, z], [wt, yt, z]
    ]);
    return part(tone, points, dec);
  }
  function box(tone, xa, xb, ya, yb, za, zb, dec = []) {
    return part(tone, [
      [xa,ya,za], [xb,ya,za], [xa,yb,za], [xb,yb,za],
      [xa,ya,zb], [xb,ya,zb], [xa,yb,zb], [xb,yb,zb]
    ], dec);
  }
  // Korin reunaa seuraava lokasuojan poikkileikkaus; viisi sivuprofiilin
  // kulmapistettä, kaksi sivupintaa => 10 3D-kärkipistettä / lokasuoja.
  function fender(side, inner, outer, profile, dec = [], tone = 'trim') {
    return part(tone, profile.flatMap(([z,y]) => [
      [side*inner,y,z], [side*outer,y,z]
    ]), dec);
  }
  // Pitkä kapea kattopilari / tuulilasin pystytuki, vinous suunnassa z.
  function pillar(side, halfX, width, lowY, highY, lowZ, highZ) {
    const xa = side*halfX - width/2, xb = side*halfX + width/2;
    const r = 0.23;
    return part('trim', [
      [xa,lowY,lowZ-r], [xb,lowY,lowZ-r],
      [xa,lowY,lowZ+r], [xb,lowY,lowZ+r],
      [xa,highY,highZ-r], [xb,highY,highZ-r],
      [xa,highY,highZ+r], [xb,highY,highZ+r]
    ]);
  }
  const seg = (a,b) => [a,b];
  const path = (vertices, close = false) => vertices.slice(1).map((b,i) => seg(vertices[i],b))
    .concat(close ? [seg(vertices[vertices.length-1],vertices[0])] : []);
  const sidePath = (side, halfX, yzs, close = false) =>
    path(yzs.map(([y,z]) => [side*halfX,y,z]),close);
  const near = (side, halfX, y,z) => [side*halfX,y,z];
  const wheel = (x,y,z,r,w,front,spokes) => ({
    center:[x,y,z],radius:r,width:w,front,spokes
  });

  // Lasit ovat koripinnan päälle maalattuja VEKTORIPINTOJA (decals).
  // Niistä ei synny uusia convex hull -kärkiä, joten alkuperäinen
  // kuperien osien 100 %:n pisterajoitus pysyy muuttumattomana.
  // Pelin piirtäjän on täytettävä lasipinnat; vanha 'glass = vain viivat'
  // ei yksin riitä. Katso mukana oleva LASIPINNAT_LUE_MINUT.txt.
  function glazing(name, points, normal, side = 0) {
    return {nimi:name, points, normal, side, tone:'glass'};
  }
  // Sivulasin x-koordinaatti seuraa katon ja ovilinjan väliä eikä leiju
  // suorana levynä korin ulkopuolella. Lopussa pieni offset estää z-fightingin.
  function skinX(sections, y, z) {
    let k=0;
    while(k<sections.length-2 && z>sections[k+1][0]) k++;
    const a=sections[k], b=sections[k+1], t=Math.min(1,Math.max(0,(z-a[0])/(b[0]-a[0])));
    const mix=(u,v)=>u+(v-u)*t;
    const wb=mix(a[1],b[1]), yb=mix(a[2],b[2]);
    const wt=mix(a[3],b[3]), yt=mix(a[4],b[4]);
    const ty=Math.min(1,Math.max(0,(y-yb)/(yt-yb)));
    return wb+(wt-wb)*ty + 0.14;
  }
  function sideGlass(side, sections, yz, name) {
    return glazing(name, yz.map(([y,z])=>[side*skinX(sections,y,z),y,z]), [side,0.15,0],side);
  }


  // 8-kulmainen vararengas: 16 pistettä. Sivusuuntainen kiekko on oikea
  // 3D-osa; varsinaiset pyörivät/ohjautuvat ajopyörät pysyvät 4 kappaleessa.
  function spare(side, x, y, z, radius, thickness, spokes = 6) {
    const points = [], dec = [], ox = side*(x+thickness/2);
    for (let i=0; i<8; i++) {
      const a = i*Math.PI/4;
      const yy = y + radius*Math.cos(a), zz = z + radius*Math.sin(a);
      points.push([side*(x-thickness/2),yy,zz], [ox,yy,zz]);
    }
    for (let i=0; i<spokes; i++) {
      const a = i*2*Math.PI/spokes;
      dec.push(seg([ox,y+0.55*Math.cos(a),z+0.55*Math.sin(a)],
                   [ox,y+radius*0.77*Math.cos(a),z+radius*0.77*Math.sin(a)]));
    }
    return part('tire',points,dec);
  }

  const specs = [
    {nimi:'KUPLA', kuvaus:'KETTERÄ JA KEVYT',
      ominaisuudet:{hp:100,maxSpd:37,acc:10,turn:2.3,grip:1.1,off:0.72,mass:0.85}},
    {nimi:'MAASTURI', kuvaus:'KESTÄVÄ, HYVÄ MAASTOSSA',
      ominaisuudet:{hp:140,maxSpd:34,acc:8,turn:1.9,grip:1.05,off:0.95,mass:1.25}},
    {nimi:'VETERAANI', kuvaus:'1910-LUKU, PANSSAROITU',
      ominaisuudet:{hp:155,maxSpd:30,acc:7,turn:1.7,grip:0.95,off:0.8,mass:1.35}},
    {nimi:'FAETONI', kuvaus:'1920-LUKU, NOPEA',
      ominaisuudet:{hp:115,maxSpd:41,acc:9,turn:1.85,grip:1,off:0.62,mass:1.1}}
  ];

  // KUPLA: kupera VW-tyylinen kattokaari, erillinen keula- ja takaluukku,
  // turvonnut lokasuojaprofiili. Kokonaispituus 40,6 dm; korin korkeus
  // noin 14,8 dm; raideleveys ja renkaat likimain 1,55 m ulkomitassa.
  function kupla() {
    const osat = [];
    const sides = [-1,1];
    // Alakori kapenee sekä pyöristyvään nokkaan että perään.
    osat.push(loft('body', [
      [-19.3,4.7,4.1,5.1,7.0],
      [-12.5,6.8,3.0,6.8,8.9],
      [12.0,6.9,3.0,6.8,9.0],
      [19.3,4.7,4.0,5.0,7.0]
    ])); // 16
    // Beetlen sivuikkunat ovat erilliset, tummahkon siniharmaat lasipinnat.
    // Ylempi reuna seuraa kaartuvaa kattoa; kaksi ikkunaa per puoli.
    const cabinSections = [
      [-11.9,6.55,8.7,4.5,11.6],
      [-7.8,6.6,9.0,4.9,13.45],
      [-3.2,6.65,9.1,5.1,14.65],
      [1.6,6.60,9.0,4.95,14.3],
      [9.0,6.55,8.7,4.15,11.1]
    ];
    const lasipinnat=[], cabinDec=[];
    for (const side of sides) {
      const rear=sideGlass(side,cabinSections,[
        [9.70,-9.35],[12.55,-7.4],[13.42,-2.25],[9.76,-2.18]
      ],'takasivuikkuna');
      const front=sideGlass(side,cabinSections,[
        [9.82,-1.52],[13.82,-1.43],[11.12,6.3],[9.62,6.50]
      ],'etuoven lasi');
      lasipinnat.push(rear,front);
      cabinDec.push(...path(rear.points,true),...path(front.points,true));
      cabinDec.push(seg(near(side,6.82,8.9,-1.0),near(side,6.82,3.9,-1.0)));
    }
    osat.push(loft('cabin', cabinSections, cabinDec)); // 20, samat 20 viivaa
    // Etu- ja takalasit ovat paikalliseen 3D-kattokaareen sovitettuja tarroja.
    lasipinnat.push(glazing('tuulilasi', [
      [-5.85,9.67,8.15],[5.85,9.67,8.15],
      [3.65,12.75,2.7],[-3.65,12.75,2.7]
    ],[0,.45,.9]));
    lasipinnat.push(glazing('takalasi', [
      [-4.7,10.1,-10.1],[4.7,10.1,-10.1],
      [4.35,13.30,-6.5],[-4.35,13.30,-6.5]
    ],[0,.42,-.91]));
    // Keulan ja takaosan kuperat kannet (ei laatikkomaiset tasasivut).
    const hoodDec = [
      seg([-3.7,8.3,17.3],[0,8.7,18.6]),
      seg([0,8.7,18.6],[3.7,8.3,17.3]),
      seg([0,8.7,18.6],[0,7.5,19.4])
    ];
    osat.push(loft('body', [
      [8.2,6.7,7.9,5.7,9.2],
      [14.7,6.25,6.5,5.2,8.9],
      [19.8,4.5,5.5,3.5,6.9]
    ],hoodDec)); // 8
    const rearDec = [
      seg([-3.1,8.0,-17.6],[3.1,8.0,-17.6]),
      seg([-2.8,8.25,-16.7],[2.8,8.25,-16.7]),
      seg([0,8.3,-16.6],[0,6.6,-19.3])
    ];
    osat.push(loft('body', [
      [-19.9,4.6,4.5,3.7,7.1],
      [-15.0,6.15,6.7,5.6,9.5],
      [-9.3,6.55,7.8,5.9,10.4]
    ],rearDec)); // 12
    for (const s of sides) {
      osat.push(fender(s,6.45,7.7,[
        [7.8,6.6],[9.7,8.0],[12.4,9.0],[15.0,8.35],[18.0,6.65]
      ], [], 'body'));
      osat.push(fender(s,6.5,7.65,[
        [-18.4,6.55],[-15.7,8.05],[-12.7,8.8],[-10.2,8.35],[-6.8,6.6]
      ], [], 'body'));
    } // 40
    osat.push(box('trim',-6.05,6.05,3.5,4.1,19.45,20.3));
    osat.push(box('trim',-6.0,6.0,3.4,4.0,-20.3,-19.5)); // 16
    const renkaat=[];
    for(const x of [-6.65,6.65]) for(const z of [12,-12])
      renkaat.push(wheel(x,3.2,z,3.2,1.8,z>0,false));
    return {...specs[0],osat,renkaat,lasipinnat};
  }

  // MAASTURI: annetun mittakuvan ulkomitat 3740x1580x1640 mm,
  // akseliväli täsmälleen 2200 mm. Napakka kolmio-/nelioviisteinen kori.
  function maasturi() {
    const osat=[];
    const face = [];
    // Fyysisesti etukappaleen säleikkö seuraa nokan z=18.7-pintaa.
    for(let i=0;i<8;i++) {
      const x=-3.45+i*0.98;
      face.push(seg([x,5.3,18.65],[x,8.0,18.65]));
    }
    // Lyhdyt pelin reunapiirrolla kehystettyinä.
    face.push(...path([[-6.7,8.6,18.65],[-4.8,8.6,18.65],[-4.8,7.7,18.65],[-6.7,7.7,18.65]],true));
    face.push(...path([[4.8,8.6,18.65],[6.7,8.6,18.65],[6.7,7.7,18.65],[4.8,7.7,18.65]],true));
    const bodyDec=[...face]; // 16 viivaa
    for (const s of [-1,1]) {
      // Yksiosainen sivuovi sekä kyljen vaakasauma.
      bodyDec.push(...sidePath(s,7.34,[[4.0,-5.1],[4.0,2.9],[9.35,2.9],[9.35,-5.1]],true));
      bodyDec.push(seg(near(s,7.35,8.15,-17.3),near(s,7.35,8.15,17.1)));
      bodyDec.push(seg(near(s,7.35,4.55,-5.5),near(s,7.35,4.55,3.1)));
    } // 12 lisää
    osat.push(box('body',-7.35,7.35,3.1,9.75,-18.55,18.65,bodyDec)); // 8
    osat.push(loft('body', [
      [4.7,7.35,8.8,6.7,10.35],
      [12.7,7.35,8.7,6.95,10.05],
      [18.50,7.15,7.7,6.7,9.5]
    ])); // 12, suora pitkä etukonepelti
    const cabinSections=[
      [-17.3,7.15,9.55,6.4,11.7],
      [-14.3,7.15,9.65,6.55,16.40],
      [0.7,7.15,9.75,6.55,16.35],
      [4.6,7.15,9.75,6.7,10.35]
    ];
    const lasipinnat=[],cabDec=[];
    for(const side of [-1,1]) {
      const rear=sideGlass(side,cabinSections,[
        [10.58,-15.45],[15.17,-13.5],[15.20,-7.40],[10.65,-7.35]
      ],'takimmainen sivuikkuna');
      const front=sideGlass(side,cabinSections,[
        [10.62,-6.58],[15.30,-6.38],[15.24,0.10],[10.55,3.02]
      ],'etuoven ikkuna');
      lasipinnat.push(rear,front);
      cabDec.push(...path(rear.points,true),...path(front.points,true));
      cabDec.push(seg(near(side,7.28,10.1,-6.9),near(side,7.0,15.4,-6.9)));
    }
    osat.push(loft('cabin', cabinSections, cabDec));
    // Maasturin suuri tuulilasi ja takalasi oikeisiin kattopintoihin.
    lasipinnat.push(glazing('tuulilasi', [
      [-6.6,10.48,4.55],[6.6,10.48,4.55],
      [5.9,15.55,0.95],[-5.9,15.55,0.95]
    ],[0,.50,.87]));
    lasipinnat.push(glazing('takalasi', [
      [-5.95,10.55,-17.34],[5.95,10.55,-17.34],
      [5.95,15.4,-14.7],[-5.95,15.4,-14.7]
    ],[0,.43,-.90]));
    // Päät niin että kappaleiden välinen etäisyys = 37,4 dm.
    osat.push(box('trim',-7.9,7.9,3.15,4.7,18.25,18.85)); // 8
    // Takapuskurin viiva kuuluu takakorin osan pintaan, ei erillistä mesh-osaa.
    for(const s of [-1,1]) {
      osat.push(fender(s,7.05,7.75,[
        [6.9,5.9],[8.5,8.4],[10.85,9.25],[13.3,8.9],[15.9,5.9]
      ], [], 'body'));
      osat.push(fender(s,7.05,7.75,[
        [-15.8,6.0],[-13.8,8.65],[-11.0,9.3],[-8.9,8.8],[-7.2,6.0]
      ], [], 'body'));
    } // 40, yhteensä 84
    const renkaat=[];
    for(const x of [-6.8,6.8]) for(const z of [11,-11])
      renkaat.push(wheel(x,3.45,z,3.45,1.9,z>0,false));
    return {...specs[1],osat,renkaat,lasipinnat};
  }

  // VETERAANI: 1910-l. nelipaikkainen avokorinen matkailuauto. Katos ei enää
  // peitä matkustamoa umpinaisena suurena kiilana. Vararengas oikealla sivulla.
  function veteraani() {
    const osat=[];
    osat.push(box('trim',-6.6,6.6,4.45,5.65,-21.2,21.3)); // 8 runkopalkki
    const hoodDec=[];
    for(const s of [-1,1]) for(const z of [11.1,12.8,14.5,16.2])
      hoodDec.push(seg(near(s,4.65,7.35,z),near(s,4.65,10.45,z)));
    osat.push(loft('body', [
      [6.5,4.65,6.45,4.35,11.35],
      [21.2,4.2,6.2,4.0,11.25]
    ], hoodDec)); // 8, 8 lamelliraitaa
    const grillDec=[];
    for(const x of [-2.35,0,2.35])
      grillDec.push(seg([x,6.2,22.1],[x,11.7,22.1]));
    osat.push(box('brass',-4.75,4.75,5.3,12.45,21.2,22.10,grillDec)); // 8
    const doorDec=[];
    for(const s of [-1,1])
      doorDec.push(seg(near(s,7.0,6.0,-6.2),near(s,7.0,11.45,-6.2)));
    // Matala, avoin matkustajakori; kaksi sivun ovirajaa eikä katettua tilaa.
    osat.push(box('body',-7.0,7.0,5.65,11.6,-21.3,6.25,doorDec)); // 8
    // Kangaskatos kapenee ja kallistuu aavistuksen keulaa kohti.
    const roofDec=[seg([-6.0,19.6,-9.2],[6.0,19.6,-9.2])];
    osat.push(loft('cabin', [
      [-22.5,6.1,17.7,5.85,18.5],
      [-13.6,6.45,19.25,6.15,20.65],
      [6.8,6.15,17.85,5.9,18.65]
    ],roofDec)); // 12
    // Kangasselkäseinämä laskeutuu takapenkin taakse.
    osat.push(loft('cabin', [
      [-22.4,6.1,12.15,5.8,18.6],
      [-19.8,6.2,12.0,6.1,19.45]
    ])); // 8
    osat.push(box('glass',-5.8,5.8,12.2,18.25,5.85,6.15)); // 8 tuulilasi
    // Erilliset pehmustetut penkit näkyvät avoimesta ohjaamosta.
    osat.push(box('cabin',-5.5,5.5,11.35,13.8,-17.5,-13.2)); // 8
    osat.push(box('cabin',-5.4,5.4,11.35,13.75,-1.1,3.0)); // 8
    // Etupilarit pitävät katoksen ja tuulilasin koossa.
    osat.push(pillar(-1,6.1,0.4,11.6,18.55,6.3,6.0)); // 8
    osat.push(pillar(1,6.1,0.4,11.6,18.55,6.3,6.0));  // 8
    for(const s of [-1,1]) {
      osat.push(fender(s,6.5,8.45,[
        [8.15,7.5],[10.0,9.0],[13.65,10.0],[17.1,9.1],[20.7,7.55]
      ]));
      osat.push(fender(s,6.55,8.45,[
        [-20.1,7.1],[-18.0,8.65],[-13.8,9.85],[-9.5,9.2],[-6.5,7.15]
      ]));
    } // 40
    // Oikeanpuoleinen iso vararengas on osageometriaa, ei ajopyörä.
    osat.push(spare(1,8.85,10.2,3.6,4.05,1.2,6)); // 16
    // Kaksi valaisinkoteloa moottorisuojan etupuolella.
    osat.push(box('brass', 4.75,5.85,9.4,11.9,20.8,22.0)); // 8
    osat.push(box('brass',-5.85,-4.75,9.4,11.9,20.8,22.0)); // 8
    const renkaat=[];
    for(const x of [-7.05,7.05]) for(const z of [14.1,-13.2])
      renkaat.push(wheel(x,4.45,z,4.45,1.55,z>0,true));
    return {...specs[2],osat,renkaat};
  }

  // FAETONI: 1920-l. pitkän keulan avoauto. Kaksi selvää ovea, lasi,
  // pehmeä avoin kattokangas ja oikean etukyljen vararengas.
  function faetoni() {
    const osat=[];
    osat.push(box('trim',-6.4,6.4,4.15,5.3,-21.3,21.7)); // 8 alusta
    const hoodDec=[];
    for(const s of [-1,1]) for(const z of [10.2,11.9,13.6,15.3,17,18.7])
      hoodDec.push(seg(near(s,4.85,7.7,z),near(s,4.85,10.95,z)));
    osat.push(loft('body', [
      [3.9,4.9,5.95,4.55,12.2],
      [21.7,4.5,5.7,4.35,12.0]
    ],hoodDec)); // 8
    const radDec=[];
    for(const x of [-2.5,0,2.5])
      radDec.push(seg([x,6.2,22.6],[x,12.3,22.6]));
    osat.push(box('brass',-5.0,5.0,5.0,13.0,21.7,22.6,radDec)); // 8
    const sideDec=[];
    for(const s of [-1,1]) {
      sideDec.push(seg(near(s,7.35,5.6,-3.2),near(s,7.35,12.5,-3.2)));
      sideDec.push(seg(near(s,7.35,5.6,-12.4),near(s,7.35,12.5,-12.4)));
      sideDec.push(...sidePath(s,7.35,[[10.9,-8.7],[11.55,-8.3],[11.55,-7.0]],false));
      sideDec.push(...sidePath(s,7.35,[[10.9,0.5],[11.55,0.9],[11.55,2.2]],false));
    } // 8 per puoli =16
    osat.push(loft('body', [
      [-21.5,6.5,5.4,6.95,11.75],
      [4.2,7.3,5.5,7.05,12.2]
    ],sideDec)); // 8
    // Kaksi avonaista istuinriviä, eivät yhtenäinen umpinainen kabiini.
    osat.push(box('cabin',-5.8,5.8,12.0,14.2,-16.8,-12.8)); // 8
    osat.push(box('cabin',-5.8,5.8,12.0,14.1,-1.7,2.3)); // 8
    // Katossa kaksi kangassaumaa ja kolme avointa neljännestä korin sivulta.
    const roofDec=[
      seg([-6.0,19.3,-12.3],[6.0,19.3,-12.3]),
      seg([-6.0,19.1,-3.7],[6.0,19.1,-3.7]),
      seg([-6.0,18.95,-18.7],[6.0,18.95,-18.7])
    ];
    osat.push(loft('cabin', [
      [-20.6,6.4,18.0,5.95,19.3],
      [3.4,6.25,18.2,5.95,19.1]
    ],roofDec)); // 8
    // Kangas taittuu takayläkulmasta sisään penkin taakse.
    osat.push(loft('cabin', [
      [-21.1,6.6,12.0,6.35,18.1],
      [-18.6,6.6,12.1,6.15,19.15]
    ])); // 8
    osat.push(box('glass',-5.95,5.95,12.25,18.3,3.35,3.67)); // 8
    osat.push(pillar(-1,6.3,0.42,12.2,18.35,4.0,3.4)); // 8
    osat.push(pillar(1,6.3,0.42,12.2,18.35,4.0,3.4)); // 8
    for(const s of [-1,1]) {
      osat.push(fender(s,6.5,8.75,[
        [8.7,7.3],[10.5,8.6],[14.4,9.95],[18.3,9.45],[22.3,7.7]
      ]));
      osat.push(fender(s,6.7,8.75,[
        [-21.2,7.3],[-18.7,8.9],[-13.45,9.75],[-9.9,9.0],[-7.1,7.35]
      ]));
    } // 40
    osat.push(spare(1,8.75,10.2,7.15,3.85,1.15,8)); // 16
    const renkaat=[];
    for(const x of [-7.2,7.2]) for(const z of [15,-13])
      renkaat.push(wheel(x,4.15,z,4.15,1.6,z>0,true));
    return {...specs[3],osat,renkaat};
  }

  const formaatti = {
    kuvaus:'Vektoriralli: jokainen osa on kupera 3D-monitahokas (convex hull). Koverat muodot useilla osilla.',
    yksikko:'desimetri (1 dm = 0,1 m); peli kertoo 0,1:llä',
    akselit:'x = oikealle, y = ylös (maa y = 0), z = eteenpäin (auton keula +z)',
    savy:'tone: body = pelaajan väri, cabin = tummempi pelaajan väri/katto, trim = metalli, brass = messinki, tire = rengas, glass = siniharmaa TÄYTETTÄVÄ lasipinta',
    koristeviivat:'dec: ääriviivoja; lasipinnat: maalattuja 3D-polygoneja, joita ei liitetä kuperaan kuoreen',
    renkaat:'center, radius, width, front, spokes; 10-kulmainen lieriö',
    ominaisuudet:'hp, maxSpd, acc, turn, grip, off, mass'
  };
  const autot = [kupla(),maasturi(),veteraani(),faetoni()];
  // Kaikissa autoissa sama lasipinnat-kenttä. Vanhojen avoautojen sivut
  // säilyvät avoimina; niiden osat-tietueissa on jo fyysiset tuulilasit.
  for(const auto of autot) if(!auto.lasipinnat) auto.lasipinnat=[];
  const data = {formaatti,autot};
  // Automaattinen vahtiraja — ei katkaise tai yksinkertaista malleja salaa.
  const alkuperaiset = {KUPLA:58, MAASTURI:42, VETERAANI:82, FAETONI:72};
  for(const auto of autot) {
    const n=auto.osat.reduce((sum,osa)=>sum+osa.points.length,0);
    const max=2*alkuperaiset[auto.nimi];
    if(n>max) throw new Error(`${auto.nimi}: ${n} > ${max} kärkipistettä`);
  }
  if(root) root.VEKTORIRALLI_AUTOT = data;
  if(typeof module !== 'undefined' && module.exports) module.exports = data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
