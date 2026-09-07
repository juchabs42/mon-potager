const SEASON_KC={start:.6,full:.9,end:.7};
const STORAGE_KEY="monPotagerSettingsV4";
const LEGACY_KEYS=["monPotagerSettingsV3","monPotagerSettingsV2"];

const CROP_PRESETS={
  tomates:{label:"Tomates",kc:1.05,color:"#e8a09a"},
  salades:{label:"Salades",kc:0.75,color:"#9dd8a7"},
  courgettes:{label:"Courgettes",kc:0.95,color:"#f0d37b"},
  carottes:{label:"Carottes",kc:0.7,color:"#efb07d"},
  haricots:{label:"Haricots",kc:0.85,color:"#93c8a8"},
  "pommes-de-terre":{label:"Pommes de terre",kc:1,color:"#c9b08d"},
  poivrons:{label:"Poivrons",kc:0.9,color:"#e4a178"},
  aubergines:{label:"Aubergines",kc:0.95,color:"#bca4d9"},
  fraisiers:{label:"Fraisiers",kc:0.8,color:"#ef9ca7"},
  aromatiques:{label:"Aromatiques",kc:0.55,color:"#97d7c6"},
  autre:{label:"Autre culture",kc:0.9,color:"#c4d8c7"}
};

const DEFAULTS={
  latitude:43.793931,
  longitude:4.014810,
  rainEfficiency:.8,
  gardenWidth:8,
  gardenHeight:4,
  defaultFlow:8,
  defaultKc:.9,
  defaultSeasonMode:"full",
  defaultLastWatering:localDateString(new Date()),
  zones:[]
};

const STATUS_COLORS={green:"#2b8148",yellow:"#b78500",orange:"#d66f1f",red:"#b13131"};
let weatherRows=[];
let deferredInstallPrompt=null;
let selectedZoneId=null;
let drawMode=false;
let interaction=null;
const dom={};

document.addEventListener("DOMContentLoaded",()=>{
  cacheDom();
  bindEvents();
  setupInstallPrompt();
  ensureInitialState();
  loadSettingsIntoForm();
  refresh();
  registerServiceWorker();
});

function cacheDom(){
  [
    "refreshButton","settingsForm","useLocationButton","installButton","installCard",
    "defaultSeasonMode","defaultCustomKcLabel","defaultKc","heroCard","advice","rainAdvice",
    "volume","duration","zonesSummary","updatedAt","etpTotal","rainTotal","zoneCount",
    "gardenSurface","forecast","weatherChart","errorMessage","locationStatus","gardenSvg",
    "planSizeText","drawModeText","addZoneButton","deleteZoneButton","zonesList","zoneForm",
    "selectedZoneSurface","zoneId","zoneName","zoneCropKey","zoneCustomCropLabel","zoneCustomCrop",
    "zoneX","zoneY","zoneWidth","zoneHeight","zoneFlow","zoneSeasonMode","zoneCustomKcLabel",
    "zoneKc","zoneLastWatering","markZoneWateredButton"
  ].forEach(id=>dom[id]=document.getElementById(id));
}

function bindEvents(){
  dom.refreshButton.addEventListener("click",refresh);
  dom.settingsForm.addEventListener("submit",saveSettings);
  dom.useLocationButton.addEventListener("click",useCurrentLocation);
  dom.installButton.addEventListener("click",installApp);
  dom.defaultSeasonMode.addEventListener("change",()=>toggleKcField(dom.defaultSeasonMode,dom.defaultCustomKcLabel));
  dom.zoneSeasonMode.addEventListener("change",()=>toggleKcField(dom.zoneSeasonMode,dom.zoneCustomKcLabel));
  dom.zoneCropKey.addEventListener("change",handleCropPresetChange);
  dom.addZoneButton.addEventListener("click",toggleDrawMode);
  dom.deleteZoneButton.addEventListener("click",deleteSelectedZone);
  dom.zoneForm.addEventListener("submit",saveZone);
  dom.markZoneWateredButton.addEventListener("click",()=>markZoneWatered(selectedZoneId));
  dom.zonesList.addEventListener("click",handleZoneListClick);
  window.addEventListener("resize",()=>weatherRows.length&&renderChart());
  bindPlanEvents();
}

function bindPlanEvents(){
  const svg=dom.gardenSvg;
  svg.addEventListener("pointerdown",onPlanPointerDown);
  svg.addEventListener("pointermove",onPlanPointerMove);
  svg.addEventListener("pointerup",onPlanPointerUp);
  svg.addEventListener("pointercancel",cancelInteraction);
}

function onPlanPointerDown(event){
  const state=settings();
  const point=svgPoint(event,state);
  const actionTarget=event.target.closest("[data-action]");

  if(drawMode){
    interaction={type:"draw",pointerId:event.pointerId,start:point,current:point,isValid:true};
    dom.gardenSvg.setPointerCapture(event.pointerId);
    renderGardenPlan(stateMetricsFromCurrent());
    return;
  }

  if(!actionTarget)return;
  const zoneId=actionTarget.getAttribute("data-zone-id");
  const zone=state.zones.find(item=>String(item.id)===String(zoneId));
  if(!zone)return;

  selectedZoneId=zoneId;
  const draft={x:zone.x,y:zone.y,width:zone.width,height:zone.height};
  const action=actionTarget.getAttribute("data-action");
  interaction={
    type:action==="resize"?"resize":"move",
    pointerId:event.pointerId,
    zoneId,
    start:point,
    startRect:{x:zone.x,y:zone.y,width:zone.width,height:zone.height},
    draftRect:draft,
    isValid:true
  };
  dom.gardenSvg.setPointerCapture(event.pointerId);
  loadSelectedZoneIntoForm();
  renderGardenPlan(stateMetricsFromCurrent());
}

function onPlanPointerMove(event){
  if(!interaction||event.pointerId!==interaction.pointerId)return;
  const state=settings();
  const point=svgPoint(event,state);

  if(interaction.type==="draw"){
    interaction.current=point;
    const rect=normalizedRect(interaction.start.x,interaction.start.y,point.x,point.y,state.gardenWidth,state.gardenHeight);
    interaction.previewRect=rect;
    interaction.isValid=rect.width>=.3&&rect.height>=.3&&!hasOverlap(rect,null,state.zones);
    renderGardenPlan(stateMetricsFromCurrent());
    return;
  }

  if(interaction.type==="move"){
    const dx=point.x-interaction.start.x;
    const dy=point.y-interaction.start.y;
    const rect={
      x:clamp(interaction.startRect.x+dx,0,state.gardenWidth-interaction.startRect.width,0),
      y:clamp(interaction.startRect.y+dy,0,state.gardenHeight-interaction.startRect.height,0),
      width:interaction.startRect.width,
      height:interaction.startRect.height
    };
    interaction.draftRect=roundRect(rect);
    interaction.isValid=!hasOverlap(interaction.draftRect,interaction.zoneId,state.zones);
    renderGardenPlan(stateMetricsFromCurrent());
    return;
  }

  if(interaction.type==="resize"){
    const minSize=.4;
    const width=clamp(point.x-interaction.startRect.x,minSize,state.gardenWidth-interaction.startRect.x,minSize);
    const height=clamp(point.y-interaction.startRect.y,minSize,state.gardenHeight-interaction.startRect.y,minSize);
    interaction.draftRect=roundRect({
      x:interaction.startRect.x,
      y:interaction.startRect.y,
      width,
      height
    });
    interaction.isValid=!hasOverlap(interaction.draftRect,interaction.zoneId,state.zones);
    renderGardenPlan(stateMetricsFromCurrent());
  }
}

function onPlanPointerUp(event){
  if(!interaction||event.pointerId!==interaction.pointerId)return;
  const state=settings();

  if(interaction.type==="draw"){
    const rect=interaction.previewRect||normalizedRect(interaction.start.x,interaction.start.y,interaction.current.x,interaction.current.y,state.gardenWidth,state.gardenHeight);
    if(rect.width<.3||rect.height<.3){
      interaction=null;
      renderGardenPlan(stateMetricsFromCurrent());
      return;
    }
    if(hasOverlap(rect,null,state.zones)){
      interaction=null;
      showError("Cette zone chevauche une autre zone. Le recouvrement est interdit.");
      render();
      return;
    }
    const zone=createZoneFromRect(rect,state);
    state.zones.push(zone);
    persistSettings(state);
    selectedZoneId=zone.id;
    drawMode=false;
    setDrawButtonLabel();
    interaction=null;
    hideError();
    render();
    return;
  }

  const index=state.zones.findIndex(zone=>String(zone.id)===String(interaction.zoneId));
  if(index<0){
    interaction=null;
    return;
  }

  if(!interaction.isValid){
    interaction=null;
    showError("Déplacement impossible : cette zone chevaucherait une autre zone.");
    render();
    return;
  }

  state.zones[index]={...state.zones[index],...interaction.draftRect};
  state.zones[index]=normalizeZone(state.zones[index],state);
  persistSettings(state);
  selectedZoneId=state.zones[index].id;
  interaction=null;
  hideError();
  render();
}

function cancelInteraction(){
  if(!interaction)return;
  interaction=null;
  renderGardenPlan(stateMetricsFromCurrent());
}

function ensureInitialState(){
  const state=settings();
  if(!state.zones.length){
    const zone=normalizeZone({
      id:createId(),
      name:"Potager",
      cropKey:"autre",
      cropCustom:"Culture principale",
      x:0,
      y:0,
      width:state.gardenWidth,
      height:state.gardenHeight,
      flow:state.defaultFlow,
      seasonMode:state.defaultSeasonMode,
      kc:state.defaultKc,
      lastWatering:state.defaultLastWatering
    },state);
    state.zones=[zone];
    persistSettings(state);
  }
  selectedZoneId=state.zones[0]?.id??null;
}

function settings(){
  const current=readStorage(STORAGE_KEY);
  if(current)return normalizeState(current);
  for(const key of LEGACY_KEYS){
    const legacy=readStorage(key);
    if(legacy){
      const migrated=normalizeState(migrateLegacy(legacy));
      persistSettings(migrated);
      return migrated;
    }
  }
  return normalizeState(DEFAULTS);
}

function readStorage(key){
  try{
    const raw=localStorage.getItem(key);
    return raw?JSON.parse(raw):null;
  }catch{return null}
}

function migrateLegacy(data){
  if(Array.isArray(data.zones)){
    return {...DEFAULTS,...data};
  }
  const surface=Math.max(.5,num(data.surface)||8);
  const width=round(Math.max(2,Math.sqrt(surface*2)),1);
  const height=round(surface/width,1);
  return {
    latitude:num(data.latitude)||DEFAULTS.latitude,
    longitude:num(data.longitude)||DEFAULTS.longitude,
    rainEfficiency:num(data.rainEfficiency)||DEFAULTS.rainEfficiency,
    gardenWidth:width,
    gardenHeight:height,
    defaultFlow:num(data.flow)||DEFAULTS.defaultFlow,
    defaultKc:num(data.kc)||DEFAULTS.defaultKc,
    defaultSeasonMode:data.seasonMode||DEFAULTS.defaultSeasonMode,
    defaultLastWatering:data.lastWatering||DEFAULTS.defaultLastWatering,
    zones:[{
      id:createId(),
      name:"Potager",
      cropKey:"autre",
      cropCustom:data.crop||"Culture principale",
      x:0,
      y:0,
      width,
      height,
      flow:num(data.flow)||DEFAULTS.defaultFlow,
      kc:num(data.kc)||DEFAULTS.defaultKc,
      seasonMode:data.seasonMode||DEFAULTS.defaultSeasonMode,
      lastWatering:data.lastWatering||DEFAULTS.defaultLastWatering
    }]
  };
}

function normalizeState(input={}){
  const state={...DEFAULTS,...input};
  state.latitude=num(state.latitude)||DEFAULTS.latitude;
  state.longitude=num(state.longitude)||DEFAULTS.longitude;
  state.rainEfficiency=clamp(num(state.rainEfficiency),0,1,DEFAULTS.rainEfficiency);
  state.gardenWidth=Math.max(1,num(state.gardenWidth)||DEFAULTS.gardenWidth);
  state.gardenHeight=Math.max(1,num(state.gardenHeight)||DEFAULTS.gardenHeight);
  state.defaultFlow=Math.max(.1,num(state.defaultFlow)||DEFAULTS.defaultFlow);
  state.defaultKc=Math.max(0,num(state.defaultKc)||DEFAULTS.defaultKc);
  state.defaultSeasonMode=state.defaultSeasonMode||DEFAULTS.defaultSeasonMode;
  state.defaultLastWatering=state.defaultLastWatering||DEFAULTS.defaultLastWatering;
  state.zones=Array.isArray(state.zones)?state.zones.map(zone=>normalizeZone(zone,state)).filter(Boolean):[];
  return state;
}

function normalizeZone(zone,state){
  if(!zone)return null;
  const width=clamp(Math.max(.1,num(zone.width)||1),.1,state.gardenWidth,state.gardenWidth);
  const height=clamp(Math.max(.1,num(zone.height)||1),.1,state.gardenHeight,state.gardenHeight);
  const x=clamp(num(zone.x),0,Math.max(0,state.gardenWidth-width),0);
  const y=clamp(num(zone.y),0,Math.max(0,state.gardenHeight-height),0);
  const guessedKey=guessCropKey(zone.cropKey||zone.crop||zone.cropCustom);
  const cropKey=guessedKey||"autre";
  const cropCustom=zone.cropCustom || (cropKey==="autre"?(zone.crop||"Culture"):
    CROP_PRESETS[cropKey].label);
  return {
    id:String(zone.id||createId()),
    name:(zone.name||"Nouvelle zone").trim(),
    cropKey,
    cropCustom:(cropCustom||"").trim(),
    x, y, width, height,
    flow:Math.max(.1,num(zone.flow)||state.defaultFlow),
    kc:Math.max(0,num(zone.kc)||state.defaultKc),
    seasonMode:zone.seasonMode||state.defaultSeasonMode,
    lastWatering:zone.lastWatering||state.defaultLastWatering
  };
}

function persistSettings(state){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(normalizeState(state)));
}

function loadSettingsIntoForm(){
  const state=settings();
  setValue("latitude",state.latitude);
  setValue("longitude",state.longitude);
  setValue("gardenWidth",state.gardenWidth);
  setValue("gardenHeight",state.gardenHeight);
  setValue("rainEfficiency",state.rainEfficiency);
  setValue("defaultFlow",state.defaultFlow);
  setValue("defaultSeasonMode",state.defaultSeasonMode);
  setValue("defaultKc",state.defaultKc);
  setValue("defaultLastWatering",state.defaultLastWatering);
  toggleKcField(dom.defaultSeasonMode,dom.defaultCustomKcLabel);
  setDrawButtonLabel();
  loadSelectedZoneIntoForm();
}

function loadSelectedZoneIntoForm(){
  const state=settings();
  let zone=getSelectedZone(state);
  if(!zone&&state.zones.length){
    zone=state.zones[0];
    selectedZoneId=zone.id;
  }
  dom.deleteZoneButton.disabled=!zone;
  dom.markZoneWateredButton.disabled=!zone;
  if(!zone){
    dom.zoneForm.reset();
    dom.selectedZoneSurface.textContent="Aucune zone sélectionnée";
    return;
  }
  setValue("zoneId",zone.id);
  setValue("zoneName",zone.name);
  setValue("zoneCropKey",zone.cropKey);
  setValue("zoneCustomCrop",zone.cropKey==="autre"?zone.cropCustom:"");
  setValue("zoneX",round(zone.x,1));
  setValue("zoneY",round(zone.y,1));
  setValue("zoneWidth",round(zone.width,1));
  setValue("zoneHeight",round(zone.height,1));
  setValue("zoneFlow",zone.flow);
  setValue("zoneSeasonMode",zone.seasonMode);
  setValue("zoneKc",zone.kc);
  setValue("zoneLastWatering",zone.lastWatering);
  toggleKcField(dom.zoneSeasonMode,dom.zoneCustomKcLabel);
  toggleCustomCropField();
  dom.selectedZoneSurface.textContent=`Surface : ${round(zone.width*zone.height,1)} m²`;
}

function handleCropPresetChange(){
  const key=dom.zoneCropKey.value;
  toggleCustomCropField();
  if(key!=="autre"){
    const preset=CROP_PRESETS[key];
    setValue("zoneKc",preset.kc);
    setValue("zoneSeasonMode","custom");
    toggleKcField(dom.zoneSeasonMode,dom.zoneCustomKcLabel);
    const currentName=dom.zoneName.value.trim();
    if(!currentName||currentName.toLowerCase().startsWith("zone ")||currentName==="Potager"){
      setValue("zoneName",preset.label);
    }
  }
}

function toggleCustomCropField(){
  const isCustom=dom.zoneCropKey.value==="autre";
  dom.zoneCustomCropLabel.style.display=isCustom?"grid":"none";
}

function toggleKcField(select,label){
  label.style.display=select.value==="custom"?"grid":"none";
}

async function refresh(){
  setLoading(true);
  hideError();
  try{
    const state=settings();
    const url=new URL("https://api.open-meteo.com/v1/forecast");
    url.search=new URLSearchParams({
      latitude:state.latitude,
      longitude:state.longitude,
      daily:["et0_fao_evapotranspiration","precipitation_sum","temperature_2m_min","temperature_2m_max","weather_code"].join(","),
      timezone:"Europe/Paris",
      past_days:"15",
      forecast_days:"16"
    }).toString();

    let response=await fetch(url,{cache:"no-store"});
    if(!response.ok){
      await wait(1200);
      response=await fetch(url,{cache:"no-store"});
    }
    if(!response.ok)throw new Error(`Open-Meteo répond ${response.status}.`);
    const data=await response.json();
    if(!data.daily?.time)throw new Error("Données météo absentes.");

    weatherRows=data.daily.time.map((date,index)=>({
      date,
      etp:num(data.daily.et0_fao_evapotranspiration[index]),
      rain:num(data.daily.precipitation_sum[index]),
      tmin:num(data.daily.temperature_2m_min[index]),
      tmax:num(data.daily.temperature_2m_max[index]),
      code:num(data.daily.weather_code[index])
    }));
    render();
  }catch(error){
    showError("Impossible d’actualiser la météo. "+error.message);
  }finally{
    setLoading(false);
  }
}

function render(){
  const state=settings();
  const today=localDateString(new Date());
  const recent=weatherRows.filter(row=>row.date<=today).slice(-7);
  const etp7=sum(recent.map(row=>row.etp));
  const rain7=sum(recent.map(row=>row.rain));
  const zoneMetrics=state.zones.map(zone=>computeZoneMetrics(zone,state,today));
  const totalVolume=sum(zoneMetrics.map(item=>item.volume));
  const totalMinutes=sum(zoneMetrics.map(item=>item.minutes));
  const zonesToWater=zoneMetrics.filter(item=>item.volume>.05).length;
  const totalSurface=sum(state.zones.map(zone=>zone.width*zone.height));
  const globalStatus=computeGlobalStatus(zoneMetrics,totalVolume);

  applyStatus(globalStatus);
  txt(dom.advice,globalStatus.title);
  txt(dom.rainAdvice,globalStatus.message);
  txt(dom.volume,`${round(totalVolume,1)} L`);
  txt(dom.duration,formatMinutes(totalMinutes));
  txt(dom.zonesSummary,`${zonesToWater} zone${zonesToWater>1?"s":""} à arroser sur ${state.zones.length}`);
  txt(dom.updatedAt,`Mis à jour à ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`);
  txt(dom.etpTotal,`${round(etp7,2)} mm`);
  txt(dom.rainTotal,`${round(rain7,2)} mm`);
  txt(dom.zoneCount,String(zonesToWater));
  txt(dom.gardenSurface,`${round(totalSurface,1)} m²`);
  txt(dom.planSizeText,`Plan : ${round(state.gardenWidth,1)} m × ${round(state.gardenHeight,1)} m`);
  txt(dom.drawModeText,drawMode?"Mode dessin actif":"Mode normal");

  renderForecast(today);
  renderChart();
  renderGardenPlan(zoneMetrics);
  renderZonesList(zoneMetrics);
  loadSelectedZoneIntoForm();
}

function computeZoneMetrics(zone,state,today){
  const period=weatherRows.filter(row=>row.date>zone.lastWatering&&row.date<=today);
  const etp=sum(period.map(row=>row.etp));
  const rain=sum(period.map(row=>row.rain));
  const etc=etp*activeKc(zone);
  const effectiveRain=rain*num(state.rainEfficiency);
  const dose=Math.max(0,etc-effectiveRain);
  const future=weatherRows.filter(row=>row.date>today).slice(0,3);
  const rain3=sum(future.map(row=>row.rain));
  const effectiveFutureRain=rain3*num(state.rainEfficiency);
  const status=computeStatus(dose,effectiveFutureRain,rain3);
  const surface=zone.width*zone.height;
  const volume=Math.max(0,status.recommendedDose*surface);
  const minutes=zone.flow>0?volume/zone.flow:0;
  const days=daysBetween(zone.lastWatering,today);
  return {zone,etp,rain,dose,status,surface,volume,minutes,rain3,days};
}

function activeKc(zone){
  return zone.seasonMode==="custom"?num(zone.kc):(SEASON_KC[zone.seasonMode]??.9);
}

function computeStatus(dose,effectiveFutureRain,rain3){
  if(dose<=.1)return {level:"green",title:"Pas besoin d’arroser",message:"Le bilan hydrique est suffisant.",recommendedDose:0};
  if(rain3>=3&&effectiveFutureRain>=dose*.65)return {level:"yellow",title:"Attendre la pluie",message:`${round(rain3,1)} mm sont prévus dans les 3 prochains jours.`,recommendedDose:0};
  if(dose<4)return {level:"yellow",title:"Arrosage léger",message:"Le déficit reste modéré.",recommendedDose:dose};
  if(dose<8)return {level:"orange",title:"Arroser aujourd’hui",message:"Le déficit devient significatif.",recommendedDose:dose};
  return {level:"red",title:"Arrosage important",message:"Le déficit cumulé est élevé.",recommendedDose:dose};
}

function computeGlobalStatus(zoneMetrics,totalVolume){
  if(!zoneMetrics.length)return {level:"green",title:"Ajoute une première zone",message:"Dessine ton potager pour obtenir un conseil d’arrosage."};
  const counts=zoneMetrics.reduce((acc,item)=>{acc[item.status.level]=(acc[item.status.level]||0)+1;return acc;},{});
  if(totalVolume<=.05)return {level:"green",title:"Pas besoin d’arroser",message:"Aucune zone ne nécessite d’arrosage pour le moment."};
  if(counts.red)return {level:"red",title:"Arrosage prioritaire",message:`${counts.red} zone${counts.red>1?"s sont prioritaires":" est prioritaire"} aujourd’hui.`};
  if(counts.orange)return {level:"orange",title:"Arroser aujourd’hui",message:`${counts.orange} zone${counts.orange>1?"s demandent":" demande"} un arrosage aujourd’hui.`};
  return {level:"yellow",title:"Arrosage léger",message:"Quelques zones ont un petit déficit hydrique."};
}

function applyStatus(status){
  dom.heroCard.className=`hero card status-${status.level}`;
}

function renderGardenPlan(zoneMetrics=[]){
  const state=settings();
  const metricsById=new Map(zoneMetrics.map(item=>[String(item.zone.id),item]));
  const svg=dom.gardenSvg;
  svg.setAttribute("viewBox",`0 0 ${state.gardenWidth} ${state.gardenHeight}`);

  let lines="";
  for(let x=0;x<=Math.floor(state.gardenWidth);x++)lines+=`<line x1="${x}" y1="0" x2="${x}" y2="${state.gardenHeight}"></line>`;
  for(let y=0;y<=Math.floor(state.gardenHeight);y++)lines+=`<line x1="0" y1="${y}" x2="${state.gardenWidth}" y2="${y}"></line>`;

  let html=`<g class="garden-grid">${lines}</g><rect class="garden-outline" x="0" y="0" width="${state.gardenWidth}" height="${state.gardenHeight}" rx="0.24" ry="0.24"></rect>`;

  for(const zone of state.zones){
    const metric=metricsById.get(String(zone.id));
    const preview=isInteractingZone(zone.id)?interaction.draftRect:null;
    const rect=preview||zone;
    const crop=getCropPreset(zone.cropKey);
    const statusColor=STATUS_COLORS[metric?.status.level||"green"];
    const selected=String(selectedZoneId)===String(zone.id);
    const cropLabel=getCropLabel(zone);
    const surface=round(rect.width*rect.height,1);
    html+=`<g data-zone-id="${zone.id}">
      <rect class="zone-rect${selected?" zone-selected":""}" data-zone-id="${zone.id}" data-action="move" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${crop.color}" stroke="${statusColor}"></rect>
      <text class="zone-label" x="${rect.x+.14}" y="${rect.y+.30}">${escapeHtml(zone.name)}</text>
      <text class="zone-sub" x="${rect.x+.14}" y="${rect.y+.54}">${escapeHtml(cropLabel)} · ${surface} m²</text>
      <text class="zone-mini-badge" x="${rect.x+.14}" y="${rect.y+.78}" fill="${statusColor}">${escapeHtml(metric?.status.title||"")}</text>
      ${selected?`<circle class="zone-handle" data-zone-id="${zone.id}" data-action="resize" cx="${rect.x+rect.width}" cy="${rect.y+rect.height}" r="0.14"></circle>`:""}
    </g>`;
  }

  if(interaction?.type==="draw"&&interaction.previewRect){
    const rect=interaction.previewRect;
    html+=`<rect class="zone-preview${interaction.isValid?"":" invalid"}" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}"></rect>`;
  }
  svg.innerHTML=html;
}

function renderZonesList(zoneMetrics){
  if(!zoneMetrics.length){
    dom.zonesList.innerHTML="<p class='muted'>Dessine une zone pour commencer.</p>";
    return;
  }
  dom.zonesList.innerHTML=zoneMetrics.map(item=>{
    const crop=getCropPreset(item.zone.cropKey);
    const cropLabel=getCropLabel(item.zone);
    return `<article class="zone-item">
      <h3>${escapeHtml(item.zone.name)}</h3>
      <p class="zone-crop">${escapeHtml(cropLabel)}</p>
      <div class="zone-badges">
        <span class="badge badge-${item.status.level}">${item.status.title}</span>
        <span class="badge">${round(item.surface,1)} m²</span>
        <span class="badge">Kc ${round(activeKc(item.zone),2)}</span>
        <span class="badge" style="background:${crop.color};color:#163020">Couleur culture</span>
      </div>
      <div class="zone-stats">
        <div><span class="metric-label">À apporter</span><strong>${round(item.volume,1)} L</strong></div>
        <div><span class="metric-label">Durée</span><strong>${formatMinutes(item.minutes)}</strong></div>
        <div><span class="metric-label">Dose nette</span><strong>${round(item.dose,2)} mm</strong></div>
        <div><span class="metric-label">Dernier arrosage</span><strong>${item.days===0?"Aujourd’hui":item.days===1?"1 jour":`${item.days} jours`}</strong></div>
      </div>
      <p class="muted">${item.status.message}</p>
      <div class="zone-actions">
        <button class="secondary-button" type="button" data-action="select" data-zone-id="${item.zone.id}">Sélectionner</button>
        <button class="ghost-button" type="button" data-action="watered" data-zone-id="${item.zone.id}">💧 J’ai arrosé</button>
      </div>
    </article>`;
  }).join("");
}

function renderForecast(today){
  dom.forecast.innerHTML="";
  weatherRows.filter(row=>row.date>=today).slice(0,7).forEach(row=>{
    const element=document.createElement("div");
    element.className="forecast-row";
    element.innerHTML=`
      <strong>${dayLabel(row.date)}</strong>
      <span class="weather-icon">${weatherIcon(row.code)}</span>
      <span>ETP ${round(row.etp,1)}</span>
      <span>🌧 ${round(row.rain,1)}</span>
      <span>${round(row.tmin,0)}° / ${round(row.tmax,0)}°</span>`;
    dom.forecast.appendChild(element);
  });
}

function renderChart(){
  const canvas=dom.weatherChart;
  const ctx=canvas.getContext("2d");
  const ratio=window.devicePixelRatio||1;
  const width=canvas.clientWidth||650;
  const height=230;
  canvas.width=width*ratio;
  canvas.height=height*ratio;
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,width,height);

  const today=localDateString(new Date());
  const rows=weatherRows.filter(row=>row.date<=today).slice(-10);
  if(!rows.length)return;

  const pad={left:30,right:10,top:16,bottom:35};
  const chartW=width-pad.left-pad.right;
  const chartH=height-pad.top-pad.bottom;
  const max=Math.max(1,...rows.flatMap(row=>[row.etp,row.rain]));
  const groupW=chartW/rows.length;
  const barW=Math.min(16,groupW*.28);

  ctx.strokeStyle="#dbe5dd";
  ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=pad.top+chartH*i/4;
    ctx.beginPath();
    ctx.moveTo(pad.left,y);
    ctx.lineTo(width-pad.right,y);
    ctx.stroke();
  }

  rows.forEach((row,index)=>{
    const x=pad.left+index*groupW+groupW/2;
    drawBar(ctx,x-barW-2,row.etp,"#e6a04b",pad,chartH,max,barW);
    drawBar(ctx,x+2,row.rain,"#4e9ad1",pad,chartH,max,barW);
    ctx.fillStyle="#68766c";
    ctx.font="10px system-ui";
    ctx.textAlign="center";
    ctx.fillText(shortDay(row.date),x,height-12);
  });
}

function drawBar(ctx,x,value,color,pad,chartH,max,barW){
  const h=(value/max)*chartH;
  ctx.fillStyle=color;
  ctx.fillRect(x,pad.top+chartH-h,barW,h);
}

function saveSettings(event){
  event.preventDefault();
  const state=settings();
  state.latitude=num(val("latitude"));
  state.longitude=num(val("longitude"));
  state.gardenWidth=Math.max(1,num(val("gardenWidth")));
  state.gardenHeight=Math.max(1,num(val("gardenHeight")));
  state.rainEfficiency=clamp(num(val("rainEfficiency")),0,1,DEFAULTS.rainEfficiency);
  state.defaultFlow=Math.max(.1,num(val("defaultFlow")));
  state.defaultSeasonMode=val("defaultSeasonMode");
  state.defaultKc=Math.max(0,num(val("defaultKc")));
  state.defaultLastWatering=val("defaultLastWatering");
  state.zones=state.zones.map(zone=>normalizeZone(zone,state));
  persistSettings(state);
  render();
}

function saveZone(event){
  event.preventDefault();
  const state=settings();
  const index=state.zones.findIndex(zone=>String(zone.id)===String(val("zoneId")));
  if(index<0)return;

  const width=Math.max(.1,num(val("zoneWidth")));
  const height=Math.max(.1,num(val("zoneHeight")));
  const x=clamp(num(val("zoneX")),0,Math.max(0,state.gardenWidth-width),0);
  const y=clamp(num(val("zoneY")),0,Math.max(0,state.gardenHeight-height),0);
  const cropKey=val("zoneCropKey");
  const zone={
    ...state.zones[index],
    name:val("zoneName").trim()||"Nouvelle zone",
    cropKey,
    cropCustom:cropKey==="autre"?(val("zoneCustomCrop").trim()||"Autre culture"):CROP_PRESETS[cropKey].label,
    x,y,width,height,
    flow:Math.max(.1,num(val("zoneFlow"))),
    seasonMode:val("zoneSeasonMode"),
    kc:Math.max(0,num(val("zoneKc"))),
    lastWatering:val("zoneLastWatering")
  };

  if(hasOverlap(zone,zone.id,state.zones)){
    showError("Enregistrement impossible : cette zone chevauche une autre zone.");
    return;
  }

  state.zones[index]=normalizeZone(zone,state);
  selectedZoneId=state.zones[index].id;
  persistSettings(state);
  hideError();
  render();
}

function handleZoneListClick(event){
  const button=event.target.closest("button[data-action]");
  if(!button)return;
  const zoneId=button.getAttribute("data-zone-id");
  const action=button.getAttribute("data-action");
  if(action==="select"){
    selectedZoneId=zoneId;
    render();
    return;
  }
  if(action==="watered")markZoneWatered(zoneId);
}

function markZoneWatered(zoneId){
  if(!zoneId)return;
  const state=settings();
  const zone=state.zones.find(item=>String(item.id)===String(zoneId));
  if(!zone)return;
  zone.lastWatering=localDateString(new Date());
  persistSettings(state);
  render();
}

function deleteSelectedZone(){
  if(!selectedZoneId)return;
  const state=settings();
  if(state.zones.length<=1){
    showError("Il doit rester au moins une zone dans le potager.");
    return;
  }
  state.zones=state.zones.filter(zone=>String(zone.id)!==String(selectedZoneId));
  selectedZoneId=state.zones[0]?.id??null;
  persistSettings(state);
  hideError();
  render();
}

function toggleDrawMode(){
  drawMode=!drawMode;
  interaction=null;
  setDrawButtonLabel();
  txt(dom.drawModeText,drawMode?"Mode dessin actif":"Mode normal");
  renderGardenPlan(stateMetricsFromCurrent());
}

function setDrawButtonLabel(){
  dom.addZoneButton.textContent=drawMode?"Annuler le dessin":"✏️ Dessiner une zone";
}

function createZoneFromRect(rect,state){
  return normalizeZone({
    id:createId(),
    name:`Zone ${state.zones.length+1}`,
    cropKey:"tomates",
    cropCustom:"Tomates",
    x:rect.x,
    y:rect.y,
    width:rect.width,
    height:rect.height,
    flow:state.defaultFlow,
    seasonMode:"custom",
    kc:CROP_PRESETS.tomates.kc,
    lastWatering:state.defaultLastWatering
  },state);
}

function hasOverlap(rect,currentZoneId,zones){
  return zones.some(zone=>String(zone.id)!==String(currentZoneId)&&rectanglesOverlap(rect,zone));
}

function rectanglesOverlap(a,b){
  return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
}

function isInteractingZone(zoneId){
  return interaction&&interaction.zoneId&&String(interaction.zoneId)===String(zoneId)&&interaction.draftRect;
}

function getSelectedZone(state){
  return state.zones.find(zone=>String(zone.id)===String(selectedZoneId))||null;
}

function getCropPreset(key){
  return CROP_PRESETS[key]||CROP_PRESETS.autre;
}

function getCropLabel(zone){
  return zone.cropKey==="autre"?(zone.cropCustom||"Autre culture"):getCropPreset(zone.cropKey).label;
}

function guessCropKey(value){
  if(!value)return null;
  const normalized=String(value).trim().toLowerCase();
  return Object.keys(CROP_PRESETS).find(key=>key===normalized||CROP_PRESETS[key].label.toLowerCase()===normalized)||null;
}

function roundRect(rect){
  return {x:round(rect.x,2),y:round(rect.y,2),width:round(rect.width,2),height:round(rect.height,2)};
}

function normalizedRect(x1,y1,x2,y2,maxWidth,maxHeight){
  const x=clamp(Math.min(x1,x2),0,maxWidth,0);
  const y=clamp(Math.min(y1,y2),0,maxHeight,0);
  const width=clamp(Math.abs(x2-x1),0,maxWidth-x,0);
  const height=clamp(Math.abs(y2-y1),0,maxHeight-y,0);
  return roundRect({x,y,width,height});
}

function stateMetricsFromCurrent(){
  const state=settings();
  const today=localDateString(new Date());
  return state.zones.map(zone=>computeZoneMetrics(zone,state,today));
}

function svgPoint(event,state=settings()){
  const rect=dom.gardenSvg.getBoundingClientRect();
  const x=((event.clientX-rect.left)/rect.width)*state.gardenWidth;
  const y=((event.clientY-rect.top)/rect.height)*state.gardenHeight;
  return {x:clamp(x,0,state.gardenWidth,0),y:clamp(y,0,state.gardenHeight,0)};
}

function useCurrentLocation(){
  if(!navigator.geolocation){
    dom.locationStatus.textContent="La géolocalisation n’est pas disponible sur cet appareil.";
    return;
  }
  dom.locationStatus.textContent="Recherche de la position…";
  navigator.geolocation.getCurrentPosition(
    position=>{
      const latitude=round(position.coords.latitude,6);
      const longitude=round(position.coords.longitude,6);
      setValue("latitude",latitude);
      setValue("longitude",longitude);
      const state=settings();
      state.latitude=latitude;
      state.longitude=longitude;
      persistSettings(state);
      dom.locationStatus.textContent=`Position enregistrée : ${latitude}, ${longitude}`;
      refresh();
    },
    error=>{
      let message="Impossible d’obtenir la position.";
      if(error.code===1)message="Autorisation de localisation refusée.";
      if(error.code===2)message="Position indisponible.";
      if(error.code===3)message="La recherche de position a expiré.";
      dom.locationStatus.textContent=message;
    },
    {enableHighAccuracy:true,timeout:15000,maximumAge:300000}
  );
}

function setupInstallPrompt(){
  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
    dom.installCard.hidden=false;
  });
  window.addEventListener("appinstalled",()=>{
    deferredInstallPrompt=null;
    dom.installCard.hidden=true;
  });
  const standalone=window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;
  if(standalone)dom.installCard.hidden=true;
}

async function installApp(){
  if(!deferredInstallPrompt){
    dom.installCard.hidden=false;
    dom.installCard.querySelector(".install-copy").textContent="Dans Chrome, ouvre le menu ⋮ puis choisis « Installer l’application » ou « Ajouter à l’écran d’accueil ».";
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null;
  dom.installCard.hidden=true;
}

function registerServiceWorker(){
  if("serviceWorker" in navigator)navigator.serviceWorker.register("./service-worker.js").catch(console.error);
}

function setLoading(value){
  dom.refreshButton.disabled=value;
  dom.refreshButton.textContent=value?"…":"↻";
}
function showError(message){dom.errorMessage.textContent=message;dom.errorMessage.hidden=false}
function hideError(){dom.errorMessage.hidden=true}
function txt(node,value){node.textContent=value}
function val(id){return document.getElementById(id).value}
function setValue(id,value){document.getElementById(id).value=value}
function num(value){const n=Number(value);return Number.isFinite(n)?n:0}
function clamp(value,min,max,fallback=min){return Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback}
function sum(values){return values.reduce((a,b)=>a+num(b),0)}
function round(value,digits){const factor=10**digits;return Math.round((num(value)+Number.EPSILON)*factor)/factor}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function formatMinutes(value){
  const totalSeconds=Math.round(num(value)*60);
  const minutes=Math.floor(totalSeconds/60);
  const seconds=totalSeconds%60;
  return `${minutes} min ${String(seconds).padStart(2,"0")} s`;
}
function localDateString(date){
  const parts=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function daysBetween(a,b){
  return Math.max(0,Math.round((new Date(`${b}T12:00:00`)-new Date(`${a}T12:00:00`))/86400000));
}
function dayLabel(value){
  const d=new Date(`${value}T12:00:00`);
  const today=localDateString(new Date());
  const tomorrow=new Date();
  tomorrow.setDate(tomorrow.getDate()+1);
  if(value===today)return "Aujourd’hui";
  if(value===localDateString(tomorrow))return "Demain";
  return d.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"});
}
function shortDay(value){
  return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"});
}
function weatherIcon(code){
  if(code===0)return "☀️";
  if([1,2].includes(code))return "🌤️";
  if(code===3)return "☁️";
  if([45,48].includes(code))return "🌫️";
  if([51,53,55,56,57].includes(code))return "🌦️";
  if([61,63,65,66,67,80,81,82].includes(code))return "🌧️";
  if([71,73,75,77,85,86].includes(code))return "🌨️";
  if([95,96,99].includes(code))return "⛈️";
  return "🌤️";
}
function createId(){return `z${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`}
function escapeHtml(text){
  return String(text).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]));
}
