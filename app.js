
const SEASON_KC={start:.6,full:.9,end:.7};
const DEFAULTS={
  latitude:43.793931,longitude:4.014810,surface:8,flow:8,kc:.9,
  seasonMode:"full",rainEfficiency:.8,lastWatering:localDateString(new Date())
};
const STORAGE_KEY="monPotagerSettingsV2";
let weatherRows=[];

document.addEventListener("DOMContentLoaded",()=>{
  bindEvents();
  loadSettingsIntoForm();
  refresh();
  registerServiceWorker();
});

function bindEvents(){
  document.querySelector("#refreshButton").addEventListener("click",refresh);
  document.querySelector("#wateredButton").addEventListener("click",markWatered);
  document.querySelector("#settingsForm").addEventListener("submit",saveSettings);
  document.querySelector("#seasonMode").addEventListener("change",toggleCustomKc);
  window.addEventListener("resize",()=>weatherRows.length&&renderChart());
}

function settings(){
  try{return{...DEFAULTS,...JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")}}
  catch{return{...DEFAULTS}}
}
function persistSettings(v){localStorage.setItem(STORAGE_KEY,JSON.stringify(v))}
function activeKc(s){return s.seasonMode==="custom"?num(s.kc):(SEASON_KC[s.seasonMode]??.9)}

function loadSettingsIntoForm(){
  const s=settings();
  ["surface","flow","kc","rainEfficiency","lastWatering","seasonMode"]
    .forEach(id=>document.querySelector("#"+id).value=s[id]);
  toggleCustomKc();
}

function toggleCustomKc(){
  const custom=document.querySelector("#seasonMode").value==="custom";
  document.querySelector("#customKcLabel").style.display=custom?"grid":"none";
}

async function refresh(){
  setLoading(true);hideError();
  try{
    const s=settings();
    const vars=[
      "et0_fao_evapotranspiration","precipitation_sum",
      "temperature_2m_min","temperature_2m_max","weather_code"
    ].join(",");
    const url=new URL("https://api.open-meteo.com/v1/forecast");
    url.search=new URLSearchParams({
      latitude:s.latitude,longitude:s.longitude,daily:vars,
      timezone:"Europe/Paris",past_days:"15",forecast_days:"16"
    }).toString();

    let response=await fetch(url,{cache:"no-store"});
    if(!response.ok){
      await wait(1200);
      response=await fetch(url,{cache:"no-store"});
    }
    if(!response.ok)throw new Error(`Open-Meteo répond ${response.status}.`);

    const d=await response.json();
    if(!d.daily?.time)throw new Error("Données météo absentes.");

    weatherRows=d.daily.time.map((date,i)=>({
      date,
      etp:num(d.daily.et0_fao_evapotranspiration[i]),
      rain:num(d.daily.precipitation_sum[i]),
      tmin:num(d.daily.temperature_2m_min[i]),
      tmax:num(d.daily.temperature_2m_max[i]),
      code:num(d.daily.weather_code[i])
    }));
    render();
  }catch(e){
    showError("Impossible d’actualiser la météo. "+e.message);
  }finally{setLoading(false)}
}

function render(){
  const s=settings();
  const today=localDateString(new Date());
  const period=weatherRows.filter(r=>r.date>s.lastWatering&&r.date<=today);

  const etp=sum(period.map(r=>r.etp));
  const rain=sum(period.map(r=>r.rain));
  const kc=activeKc(s);
  const etc=etp*kc;
  const effectiveRain=rain*num(s.rainEfficiency);
  const dose=Math.max(0,etc-effectiveRain);
  const volume=dose*num(s.surface);
  const minutes=num(s.flow)>0?volume/num(s.flow):0;

  const future=weatherRows.filter(r=>r.date>today).slice(0,3);
  const rain3=sum(future.map(r=>r.rain));
  const effectiveFutureRain=rain3*num(s.rainEfficiency);

  const status=computeStatus(dose,effectiveFutureRain,rain3);
  applyStatus(status);

  txt("#advice",status.title);
  txt("#rainAdvice",status.message);
  txt("#volume",`${round(status.recommendedDose*num(s.surface),1)} L`);
  txt("#duration",formatMinutes(status.recommendedDose*num(s.surface)/num(s.flow)));
  txt("#etpTotal",`${round(etp,2)} mm`);
  txt("#rainTotal",`${round(rain,2)} mm`);
  txt("#dose",`${round(dose,2)} mm`);
  txt("#rain3Days",`${round(rain3,1)} mm`);

  const days=daysBetween(s.lastWatering,today);
  txt("#lastWateringText",`Dernier arrosage : ${formatDate(s.lastWatering)}`);
  txt("#daysSinceWatering",days===0?"Aujourd’hui":days===1?"Il y a 1 jour":`Il y a ${days} jours`);
  txt("#updatedAt",`Mis à jour à ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`);

  renderForecast(today);
  renderChart();
}

function computeStatus(dose,effectiveFutureRain,rain3){
  if(dose<=.1){
    return{level:"green",title:"Pas besoin d’arroser",message:"Le bilan hydrique est actuellement suffisant.",recommendedDose:0};
  }

  if(rain3>=3 && effectiveFutureRain>=dose*.65){
    return{
      level:"yellow",
      title:"Attendre la pluie",
      message:`${round(rain3,1)} mm sont prévus dans les 3 prochains jours.`,
      recommendedDose:0
    };
  }

  if(dose<4){
    return{level:"yellow",title:"Arrosage léger",message:"Le déficit reste modéré.",recommendedDose:dose};
  }
  if(dose<8){
    return{level:"orange",title:"Arroser aujourd’hui",message:"Le déficit devient significatif.",recommendedDose:dose};
  }
  return{level:"red",title:"Arrosage important",message:"Le déficit cumulé est élevé.",recommendedDose:dose};
}

function applyStatus(status){
  const card=document.querySelector("#heroCard");
  card.className=`hero card status-${status.level}`;
}

function renderForecast(today){
  const c=document.querySelector("#forecast");c.innerHTML="";
  weatherRows.filter(r=>r.date>=today).slice(0,7).forEach(r=>{
    const e=document.createElement("div");
    e.className="forecast-row";
    e.innerHTML=`
      <strong>${dayLabel(r.date)}</strong>
      <span class="weather-icon">${weatherIcon(r.code)}</span>
      <span>ETP ${round(r.etp,1)}</span>
      <span>🌧 ${round(r.rain,1)}</span>
      <span>${round(r.tmin,0)}° / ${round(r.tmax,0)}°</span>`;
    c.appendChild(e);
  });
}

function renderChart(){
  const canvas=document.querySelector("#weatherChart");
  const ctx=canvas.getContext("2d");
  const ratio=window.devicePixelRatio||1;
  const width=canvas.clientWidth||650,height=230;
  canvas.width=width*ratio;canvas.height=height*ratio;
  ctx.scale(ratio,ratio);ctx.clearRect(0,0,width,height);

  const today=localDateString(new Date());
  const rows=weatherRows.filter(r=>r.date<=today).slice(-10);
  if(!rows.length)return;

  const pad={left:30,right:10,top:16,bottom:35};
  const chartW=width-pad.left-pad.right,chartH=height-pad.top-pad.bottom;
  const max=Math.max(1,...rows.flatMap(r=>[r.etp,r.rain]));
  const groupW=chartW/rows.length,barW=Math.min(16,groupW*.28);

  ctx.strokeStyle="#dbe5dd";ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=pad.top+chartH*i/4;
    ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right,y);ctx.stroke();
  }

  rows.forEach((r,i)=>{
    const x=pad.left+i*groupW+groupW/2;
    drawBar(ctx,x-barW-2,r.etp,"#e6a04b");
    drawBar(ctx,x+2,r.rain,"#4e9ad1");
    ctx.fillStyle="#68766c";ctx.font="10px system-ui";ctx.textAlign="center";
    ctx.fillText(shortDay(r.date),x,height-12);

    function drawBar(context,bx,value,color){
      const h=(value/max)*chartH;
      context.fillStyle=color;
      context.fillRect(bx,pad.top+chartH-h,barW,h);
    }
  });
}

function weatherIcon(code){
  if(code===0)return"☀️";
  if([1,2].includes(code))return"🌤️";
  if(code===3)return"☁️";
  if([45,48].includes(code))return"🌫️";
  if([51,53,55,56,57].includes(code))return"🌦️";
  if([61,63,65,66,67,80,81,82].includes(code))return"🌧️";
  if([71,73,75,77,85,86].includes(code))return"🌨️";
  if([95,96,99].includes(code))return"⛈️";
  return"🌤️";
}

function markWatered(){
  const s=settings();
  s.lastWatering=localDateString(new Date());
  persistSettings(s);loadSettingsIntoForm();render();
}

function saveSettings(e){
  e.preventDefault();
  const s=settings();
  const n={
    ...s,
    surface:num(val("surface")),flow:num(val("flow")),
    kc:num(val("kc")),seasonMode:val("seasonMode"),
    rainEfficiency:num(val("rainEfficiency")),
    lastWatering:val("lastWatering")
  };
  persistSettings(n);render();
}

function registerServiceWorker(){
  if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(console.error);
}
function setLoading(v){const b=document.querySelector("#refreshButton");b.disabled=v;b.textContent=v?"…":"↻"}
function showError(m){const e=document.querySelector("#errorMessage");e.textContent=m;e.hidden=false}
function hideError(){document.querySelector("#errorMessage").hidden=true}
function txt(s,v){document.querySelector(s).textContent=v}
function val(id){return document.querySelector("#"+id).value}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function sum(v){return v.reduce((a,b)=>a+num(b),0)}
function round(v,d){const f=10**d;return Math.round((num(v)+Number.EPSILON)*f)/f}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function formatMinutes(v){const sec=Math.round(num(v)*60),m=Math.floor(sec/60),s=sec%60;return`${m} min ${String(s).padStart(2,"0")} s`}
function localDateString(date){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return`${m.year}-${m.month}-${m.day}`;
}
function formatDate(s){return new Date(s+"T12:00:00").toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}
function daysBetween(a,b){return Math.max(0,Math.round((new Date(b+"T12:00:00")-new Date(a+"T12:00:00"))/86400000))}
function dayLabel(s){
  const d=new Date(s+"T12:00:00"),today=localDateString(new Date()),t=new Date();t.setDate(t.getDate()+1);
  if(s===today)return"Aujourd’hui";if(s===localDateString(t))return"Demain";
  return d.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"});
}
function shortDay(s){return new Date(s+"T12:00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"})}
