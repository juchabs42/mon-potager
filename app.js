const SEASON_KC={start:.6,full:.9,end:.7};
const STORAGE_KEY="monPotagerSettingsV8";
const LEGACY_KEYS=["monPotagerSettingsV7","monPotagerSettingsV6","monPotagerSettingsV5","monPotagerSettingsV4","monPotagerSettingsV3","monPotagerSettingsV2"];

const CROP_PRESETS={
  tomates:{label:"Tomates",kc:1.05,color:"#ef756f"},
  mais:{label:"Maïs",kc:1.05,color:"#f2cf52"},
  salades:{label:"Salades",kc:0.75,color:"#8fce8e"},
  courgettes:{label:"Courgettes",kc:0.95,color:"#a8c96f"},
  carottes:{label:"Carottes",kc:0.70,color:"#eea35f"},
  haricots:{label:"Haricots",kc:0.85,color:"#78b99a"},
  "pommes-de-terre":{label:"Pommes de terre",kc:1.00,color:"#c9ad7d"},
  poivrons:{label:"Poivrons",kc:0.90,color:"#ef8c65"},
  aubergines:{label:"Aubergines",kc:0.95,color:"#b49ad0"},
  fraisiers:{label:"Fraisiers",kc:0.80,color:"#e98fa0"},
  aromatiques:{label:"Aromatiques",kc:0.55,color:"#79c8b1"},
  autre:{label:"Autre culture",kc:0.90,color:"#b8cfbd"}
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
  locationName:"Lieu actuel",
  favoriteLocations:[],
  zones:[]
};

const STATUS_COLORS={green:"#2b8148",yellow:"#b78500",orange:"#d66f1f",red:"#b13131"};
let weatherRows=[];
let weatherSelectedDate=null;
let planZoom=1;
let locationSearchResults=[];
let deferredInstallPrompt=null;
let selectedZoneId=null;
let drawMode=false;
let interaction=null;
const dom={};

document.addEventListener("DOMContentLoaded",()=>{
  cacheDom();
  bindEvents();
  setupInstallPrompt();
  initializeState();
  loadPlanIntoForm();
  loadSelectedZoneIntoForm();
  refresh();
  registerServiceWorker();
});

function cacheDom(){
  [
    "refreshButton","installButton","installCard","heroCard","advice","rainAdvice","volume",
    "duration","zonesSummary","updatedAt","etpTotal","rainTotal","zoneCount","gardenSurface",
    "errorMessage","gardenSvg","planWrapper","planSizeText","drawModeText","addZoneButton","deleteZoneButton",
    "planForm","gardenWidth","gardenHeight","zoomOutButton","zoomInButton","zoomResetButton","zoomValue",
    "zonesList","zoneForm","noZoneMessage","selectedZoneSurface",
    "zoneId","zoneName","zoneCropKey","zoneCustomCropLabel","zoneCustomCrop","zoneFinished","zoneFlow","zoneSeasonMode",
    "zoneCustomKcLabel","zoneKc","zoneLastWatering","weatherDate","weatherPrevButton","weatherNextButton",
    "weatherDayIcon","weatherDayType","weatherDayLabel","weatherTemp","weatherRain","weatherEtp",
    "currentLocationName","useCurrentLocationButton","toggleLocationSearchButton","favoriteLocationButton",
    "locationSearchForm","locationSearchInput","locationSearchResults","locationFavorites","locationStatus"
  ].forEach(id=>dom[id]=document.getElementById(id));
}

function bindEvents(){
  dom.refreshButton.addEventListener("click",refresh);
  dom.installButton.addEventListener("click",installApp);
  dom.useCurrentLocationButton.addEventListener("click",useCurrentLocation);
  dom.toggleLocationSearchButton.addEventListener("click",toggleLocationSearch);
  dom.favoriteLocationButton.addEventListener("click",toggleCurrentLocationFavorite);
  dom.locationSearchForm.addEventListener("submit",searchLocation);
  dom.locationSearchResults.addEventListener("click",handleLocationSearchResultClick);
  dom.locationFavorites.addEventListener("click",handleFavoriteLocationClick);
  dom.zoomOutButton.addEventListener("click",()=>changePlanZoom(-.25));
  dom.zoomInButton.addEventListener("click",()=>changePlanZoom(.25));
  dom.zoomResetButton.addEventListener("click",()=>setPlanZoom(1));
  dom.addZoneButton.addEventListener("click",toggleDrawMode);
  dom.deleteZoneButton.addEventListener("click",deleteSelectedZone);
  dom.planForm.addEventListener("submit",savePlanDimensions);
  dom.zoneForm.addEventListener("submit",saveZone);
  dom.zoneCropKey.addEventListener("change",handleCropPresetChange);
  dom.zoneSeasonMode.addEventListener("change",()=>toggleKcField(dom.zoneSeasonMode,dom.zoneCustomKcLabel));
  dom.zonesList.addEventListener("click",handleZoneListClick);
  dom.weatherDate.addEventListener("change",()=>{
    weatherSelectedDate=dom.weatherDate.value;
    renderWeatherDay();
  });
  dom.weatherPrevButton.addEventListener("click",()=>moveWeatherDate(-1));
  dom.weatherNextButton.addEventListener("click",()=>moveWeatherDate(1));
  bindPlanEvents();
}

function bindPlanEvents(){
  dom.gardenSvg.addEventListener("pointerdown",onPlanPointerDown);
  dom.gardenSvg.addEventListener("pointermove",onPlanPointerMove);
  dom.gardenSvg.addEventListener("pointerup",onPlanPointerUp);
  dom.gardenSvg.addEventListener("pointercancel",cancelInteraction);
}

function initializeState(){
  const state=settings();
  if(state.zones.length)selectedZoneId=state.zones[0].id;
  else selectedZoneId=null;
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

  if(!actionTarget){
    if(planZoom>1){
      interaction={
        type:"pan",pointerId:event.pointerId,startClientX:event.clientX,startClientY:event.clientY,
        startScrollLeft:dom.planWrapper.scrollLeft,startScrollTop:dom.planWrapper.scrollTop
      };
      dom.gardenSvg.setPointerCapture(event.pointerId);
    }
    return;
  }
  const zoneId=actionTarget.getAttribute("data-zone-id");
  const zone=state.zones.find(item=>String(item.id)===String(zoneId));
  if(!zone)return;

  selectedZoneId=zoneId;
  interaction={
    type:actionTarget.getAttribute("data-action")==="resize"?"resize":"move",
    pointerId:event.pointerId,
    zoneId,
    start:point,
    startRect:{x:zone.x,y:zone.y,width:zone.width,height:zone.height},
    draftRect:{x:zone.x,y:zone.y,width:zone.width,height:zone.height},
    isValid:true
  };
  dom.gardenSvg.setPointerCapture(event.pointerId);
  loadSelectedZoneIntoForm();
  renderGardenPlan(stateMetricsFromCurrent());
}

function onPlanPointerMove(event){
  if(!interaction||event.pointerId!==interaction.pointerId)return;
  if(interaction.type==="pan"){
    dom.planWrapper.scrollLeft=interaction.startScrollLeft-(event.clientX-interaction.startClientX);
    dom.planWrapper.scrollTop=interaction.startScrollTop-(event.clientY-interaction.startClientY);
    return;
  }
  const state=settings();
  const point=svgPoint(event,state);

  if(interaction.type==="draw"){
    interaction.current=point;
    interaction.previewRect=normalizedRect(
      interaction.start.x,interaction.start.y,point.x,point.y,state.gardenWidth,state.gardenHeight
    );
    interaction.isValid=interaction.previewRect.width>=.3&&interaction.previewRect.height>=.3&&!hasOverlap(interaction.previewRect,null,state.zones);
    renderGardenPlan(stateMetricsFromCurrent());
    return;
  }

  if(interaction.type==="move"){
    const dx=point.x-interaction.start.x;
    const dy=point.y-interaction.start.y;
    interaction.draftRect=roundRect({
      x:clamp(interaction.startRect.x+dx,0,state.gardenWidth-interaction.startRect.width,0),
      y:clamp(interaction.startRect.y+dy,0,state.gardenHeight-interaction.startRect.height,0),
      width:interaction.startRect.width,
      height:interaction.startRect.height
    });
    interaction.isValid=!hasOverlap(interaction.draftRect,interaction.zoneId,state.zones);
    renderGardenPlan(stateMetricsFromCurrent());
    return;
  }

  if(interaction.type==="resize"){
    const minSize=.4;
    interaction.draftRect=roundRect({
      x:interaction.startRect.x,
      y:interaction.startRect.y,
      width:clamp(point.x-interaction.startRect.x,minSize,state.gardenWidth-interaction.startRect.x,minSize),
      height:clamp(point.y-interaction.startRect.y,minSize,state.gardenHeight-interaction.startRect.y,minSize)
    });
    interaction.isValid=!hasOverlap(interaction.draftRect,interaction.zoneId,state.zones);
    renderGardenPlan(stateMetricsFromCurrent());
  }
}

function onPlanPointerUp(event){
  if(!interaction||event.pointerId!==interaction.pointerId)return;
  if(interaction.type==="pan"){interaction=null;return;}
  const state=settings();

  if(interaction.type==="draw"){
    const rect=interaction.previewRect||normalizedRect(
      interaction.start.x,interaction.start.y,interaction.current.x,interaction.current.y,state.gardenWidth,state.gardenHeight
    );
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
  if(index<0){interaction=null;return;}

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
  if(Array.isArray(data.zones))return {...DEFAULTS,...data};
  const surface=Math.max(.5,num(data.surface)||8);
  const width=round(Math.max(2,Math.sqrt(surface*2)),1);
  const height=round(surface/width,1);
  return {
    ...DEFAULTS,
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
      x:0,y:0,width,height,
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
  state.locationName=(state.locationName||"Lieu actuel").trim();
  state.favoriteLocations=Array.isArray(state.favoriteLocations)?state.favoriteLocations
    .map(item=>normalizeFavoriteLocation(item)).filter(Boolean).slice(0,12):[];
  state.zones=Array.isArray(state.zones)?state.zones.map(zone=>normalizeZone(zone,state)).filter(Boolean):[];
  return state;
}

function normalizeZone(zone,state){
  if(!zone)return null;
  const width=clamp(Math.max(.1,num(zone.width)||1),.1,state.gardenWidth,state.gardenWidth);
  const height=clamp(Math.max(.1,num(zone.height)||1),.1,state.gardenHeight,state.gardenHeight);
  const x=clamp(num(zone.x),0,Math.max(0,state.gardenWidth-width),0);
  const y=clamp(num(zone.y),0,Math.max(0,state.gardenHeight-height),0);
  const cropKey=guessCropKey(zone.cropKey||zone.crop||zone.cropCustom)||"autre";
  const cropCustom=zone.cropCustom||(cropKey==="autre"?(zone.crop||"Culture"):CROP_PRESETS[cropKey].label);
  return {
    id:String(zone.id||createId()),
    name:(zone.name||"Nouvelle zone").trim(),
    cropKey,
    cropCustom:(cropCustom||"").trim(),
    x,y,width,height,
    flow:Math.max(.1,num(zone.flow)||state.defaultFlow),
    kc:Math.max(0,num(zone.kc)||state.defaultKc),
    seasonMode:zone.seasonMode||state.defaultSeasonMode,
    lastWatering:zone.lastWatering||state.defaultLastWatering,
    finished:Boolean(zone.finished)
  };
}

function persistSettings(state){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(normalizeState(state)));
}

function loadPlanIntoForm(){
  const state=settings();
  dom.gardenWidth.value=state.gardenWidth;
  dom.gardenHeight.value=state.gardenHeight;
  setDrawButtonLabel();
}

function loadSelectedZoneIntoForm(){
  const state=settings();
  const zone=getSelectedZone(state);
  dom.deleteZoneButton.disabled=!zone;

  if(!zone){
    dom.zoneForm.hidden=true;
    dom.noZoneMessage.hidden=false;
    dom.selectedZoneSurface.textContent="Aucune zone sélectionnée";
    return;
  }

  dom.zoneForm.hidden=false;
  dom.noZoneMessage.hidden=true;
  dom.zoneId.value=zone.id;
  dom.zoneName.value=zone.name;
  dom.zoneCropKey.value=zone.cropKey;
  dom.zoneCustomCrop.value=zone.cropKey==="autre"?zone.cropCustom:"";
  dom.zoneFinished.checked=Boolean(zone.finished);
  dom.zoneFlow.value=zone.flow;
  dom.zoneSeasonMode.value=zone.seasonMode;
  dom.zoneKc.value=zone.kc;
  dom.zoneLastWatering.value=zone.lastWatering;
  toggleKcField(dom.zoneSeasonMode,dom.zoneCustomKcLabel);
  toggleCustomCropField();
  dom.selectedZoneSurface.textContent=`Surface : ${round(zone.width*zone.height,1)} m²`;
}

function handleCropPresetChange(){
  const key=dom.zoneCropKey.value;
  toggleCustomCropField();
  if(key!=="autre"){
    const preset=CROP_PRESETS[key];
    dom.zoneKc.value=preset.kc;
    dom.zoneSeasonMode.value="custom";
    toggleKcField(dom.zoneSeasonMode,dom.zoneCustomKcLabel);
    const currentName=dom.zoneName.value.trim();
    if(!currentName||currentName.toLowerCase().startsWith("zone ")||currentName==="Potager")dom.zoneName.value=preset.label;
  }
}

function toggleCustomCropField(){
  dom.zoneCustomCropLabel.style.display=dom.zoneCropKey.value==="autre"?"grid":"none";
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
      past_days:"30",
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

    setupWeatherDateSelector();
    render();
  }catch(error){
    showError("Impossible d’actualiser la météo. "+error.message);
  }finally{
    setLoading(false);
  }
}

function setupWeatherDateSelector(){
  if(!weatherRows.length)return;
  const first=weatherRows[0].date;
  const last=weatherRows[weatherRows.length-1].date;
  const today=localDateString(new Date());
  if(!weatherSelectedDate||weatherSelectedDate<first||weatherSelectedDate>last){
    weatherSelectedDate=weatherRows.some(row=>row.date===today)?today:last;
  }
  dom.weatherDate.min=first;
  dom.weatherDate.max=last;
  dom.weatherDate.value=weatherSelectedDate;
  updateWeatherNavButtons();
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

  dom.heroCard.className=`hero card status-${globalStatus.level}`;
  dom.advice.textContent=globalStatus.title;
  dom.rainAdvice.textContent=globalStatus.message;
  dom.volume.textContent=`${round(totalVolume,1)} L`;
  dom.duration.textContent=formatMinutes(totalMinutes);
  dom.zonesSummary.textContent=`${zonesToWater} zone${zonesToWater>1?"s":""} à arroser sur ${state.zones.length}`;
  dom.updatedAt.textContent=`Mis à jour à ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`;
  dom.etpTotal.textContent=`${round(etp7,2)} mm`;
  dom.rainTotal.textContent=`${round(rain7,2)} mm`;
  dom.zoneCount.textContent=String(zonesToWater);
  dom.gardenSurface.textContent=`${round(totalSurface,1)} m²`;
  dom.planSizeText.textContent=`Plan : ${round(state.gardenWidth,1)} m × ${round(state.gardenHeight,1)} m · 1 carré = 0,25 m²`;
  dom.drawModeText.textContent=drawMode?"Mode dessin actif":"Mode normal";

  renderLocationCard();
  applyPlanZoom();
  renderGardenPlan(zoneMetrics);
  renderZonesList(zoneMetrics);
  renderWeatherDay();
  loadSelectedZoneIntoForm();
}

function computeZoneMetrics(zone,state,today){
  const period=weatherRows.filter(row=>row.date>zone.lastWatering&&row.date<=today);
  const etp=sum(period.map(row=>row.etp));
  const rain=sum(period.map(row=>row.rain));
  const surface=zone.width*zone.height;
  const days=daysBetween(zone.lastWatering,today);

  if(zone.finished){
    return {
      zone,etp,rain,dose:0,surface,volume:0,minutes:0,rain3:0,days,
      status:{
        level:"green",
        title:"Culture terminée",
        message:"Aucun arrosage n’est calculé pour cette zone.",
        recommendedDose:0
      }
    };
  }

  const etc=etp*activeKc(zone);
  const effectiveRain=rain*num(state.rainEfficiency);
  const dose=Math.max(0,etc-effectiveRain);
  const future=weatherRows.filter(row=>row.date>today).slice(0,3);
  const rain3=sum(future.map(row=>row.rain));
  const effectiveFutureRain=rain3*num(state.rainEfficiency);
  const status=computeStatus(dose,effectiveFutureRain,rain3);
  const volume=Math.max(0,status.recommendedDose*surface);
  const minutes=zone.flow>0?volume/zone.flow:0;
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
  if(!zoneMetrics.length)return {level:"green",title:"Dessine ton potager",message:"Ajoute les différentes cultures sur le plan pour obtenir les conseils d’arrosage."};
  const counts=zoneMetrics.reduce((acc,item)=>{acc[item.status.level]=(acc[item.status.level]||0)+1;return acc;},{});
  if(totalVolume<=.05)return {level:"green",title:"Pas besoin d’arroser",message:"Aucune zone ne nécessite d’arrosage pour le moment."};
  if(counts.red)return {level:"red",title:"Arrosage prioritaire",message:`${counts.red} zone${counts.red>1?"s sont prioritaires":" est prioritaire"} aujourd’hui.`};
  if(counts.orange)return {level:"orange",title:"Arroser aujourd’hui",message:`${counts.orange} zone${counts.orange>1?"s demandent":" demande"} un arrosage aujourd’hui.`};
  return {level:"yellow",title:"Arrosage léger",message:"Quelques zones ont un petit déficit hydrique."};
}

function renderGardenPlan(zoneMetrics=[]){
  const state=settings();
  const metricsById=new Map(zoneMetrics.map(item=>[String(item.zone.id),item]));
  dom.gardenSvg.setAttribute("viewBox",`0 0 ${state.gardenWidth} ${state.gardenHeight}`);
  dom.gardenSvg.style.aspectRatio=`${state.gardenWidth} / ${state.gardenHeight}`;
  applyPlanZoom();

  let lines="";
  const gridStep=.5;
  for(let x=0;x<=state.gardenWidth+.0001;x+=gridStep){
    const gx=round(Math.min(x,state.gardenWidth),2);
    lines+=`<line x1="${gx}" y1="0" x2="${gx}" y2="${state.gardenHeight}"></line>`;
  }
  for(let y=0;y<=state.gardenHeight+.0001;y+=gridStep){
    const gy=round(Math.min(y,state.gardenHeight),2);
    lines+=`<line x1="0" y1="${gy}" x2="${state.gardenWidth}" y2="${gy}"></line>`;
  }

  let html=`<g class="garden-grid">${lines}</g><rect class="garden-outline" x="0" y="0" width="${state.gardenWidth}" height="${state.gardenHeight}" rx="0.24" ry="0.24"></rect>`;

  for(const zone of state.zones){
    const metric=metricsById.get(String(zone.id));
    const rect=isInteractingZone(zone.id)?interaction.draftRect:zone;
    const crop=getCropPreset(zone.cropKey);
    const statusColor=STATUS_COLORS[metric?.status.level||"green"];
    const selected=String(selectedZoneId)===String(zone.id);
    const zoneLabel=zone.name||"Zone";
    const liters=metric?`${round(metric.volume,1)} L`:"— L";
    const centerX=rect.x+rect.width/2;
    const centerY=rect.y+rect.height/2;
    const textLayout=zoneTextLayout(zoneLabel,liters,rect);

    html+=`<g data-zone-id="${zone.id}">
      <rect class="zone-rect${selected?" zone-selected":""}" data-zone-id="${zone.id}" data-action="move" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${crop.color}" stroke="${statusColor}"></rect>
      <text class="zone-label" text-anchor="middle" x="${centerX}" y="${textLayout.labelY}" font-size="${textLayout.labelFont}"${textLayout.labelTextLength}>${escapeHtml(zoneLabel)}</text>
      <text class="zone-liters" text-anchor="middle" x="${centerX}" y="${textLayout.litersY}" font-size="${textLayout.litersFont}"${textLayout.litersTextLength}>${escapeHtml(liters)}</text>
      ${selected?`<circle class="zone-handle" data-zone-id="${zone.id}" data-action="resize" cx="${rect.x+rect.width}" cy="${rect.y+rect.height}" r="0.11"></circle>`:""}
    </g>`;
  }

  if(interaction?.type==="draw"&&interaction.previewRect){
    const rect=interaction.previewRect;
    html+=`<rect class="zone-preview${interaction.isValid?"":" invalid"}" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}"></rect>`;
  }
  dom.gardenSvg.innerHTML=html;
}

function renderZonesList(zoneMetrics){
  if(!zoneMetrics.length){
    dom.zonesList.innerHTML="<p class='muted'>Dessine une zone pour commencer.</p>";
    return;
  }

  dom.zonesList.innerHTML=zoneMetrics.map(item=>{
    const cropLabel=getCropLabel(item.zone);
    return `<article class="zone-item">
      <h3>${escapeHtml(cropLabel)}</h3>
      <p class="zone-crop">${escapeHtml(item.zone.name)}</p>
      <div class="zone-badges">
        <span class="badge badge-${item.status.level}">${item.status.title}</span>
        <span class="badge">${round(item.surface,1)} m²</span>
        <span class="badge">Kc ${round(activeKc(item.zone),2)}</span>
      </div>
      <div class="zone-stats">
        <div><span class="metric-label">À apporter</span><strong>${round(item.volume,1)} L</strong></div>
        <div><span class="metric-label">Durée</span><strong>${formatMinutes(item.minutes)}</strong></div>
        <div><span class="metric-label">Dose nette</span><strong>${round(item.dose,2)} mm</strong></div>
        <div><span class="metric-label">Dernier arrosage</span><strong>${item.days===0?"Aujourd’hui":item.days===1?"1 jour":`${item.days} jours`}</strong></div>
      </div>
      <p class="muted">${item.status.message}</p>
      <div class="zone-actions">
        ${item.zone.finished?`<span class="finished-note">Culture terminée</span>`:`<button class="ghost-button" type="button" data-action="watered" data-zone-id="${item.zone.id}">💧 J’ai arrosé</button>`}
      </div>
    </article>`;
  }).join("");
}

function renderWeatherDay(){
  if(!weatherRows.length){
    dom.weatherDayType.textContent="—";
    dom.weatherDayLabel.textContent="Données indisponibles";
    dom.weatherTemp.textContent="—";
    dom.weatherRain.textContent="—";
    dom.weatherEtp.textContent="—";
    return;
  }

  if(!weatherSelectedDate)weatherSelectedDate=localDateString(new Date());
  const row=weatherRows.find(item=>item.date===weatherSelectedDate)||weatherRows[weatherRows.length-1];
  weatherSelectedDate=row.date;
  dom.weatherDate.value=row.date;

  const today=localDateString(new Date());
  const type=row.date<today?"Historique":row.date===today?"Aujourd’hui":"Prévision";
  dom.weatherDayIcon.textContent=weatherIcon(row.code);
  dom.weatherDayType.textContent=type;
  dom.weatherDayLabel.textContent=formatLongDate(row.date);
  dom.weatherTemp.textContent=`${round(row.tmin,0)}° / ${round(row.tmax,0)}°`;
  dom.weatherRain.textContent=`${round(row.rain,1)} mm`;
  dom.weatherEtp.textContent=`${round(row.etp,1)} mm`;
  updateWeatherNavButtons();
}

function moveWeatherDate(step){
  if(!weatherRows.length)return;
  const index=weatherRows.findIndex(row=>row.date===weatherSelectedDate);
  const nextIndex=clamp(index+step,0,weatherRows.length-1,0);
  weatherSelectedDate=weatherRows[nextIndex].date;
  dom.weatherDate.value=weatherSelectedDate;
  renderWeatherDay();
}

function updateWeatherNavButtons(){
  if(!weatherRows.length){
    dom.weatherPrevButton.disabled=true;
    dom.weatherNextButton.disabled=true;
    return;
  }
  const index=weatherRows.findIndex(row=>row.date===weatherSelectedDate);
  dom.weatherPrevButton.disabled=index<=0;
  dom.weatherNextButton.disabled=index<0||index>=weatherRows.length-1;
}

function savePlanDimensions(event){
  event.preventDefault();
  const state=settings();
  const width=Math.max(1,num(dom.gardenWidth.value));
  const height=Math.max(1,num(dom.gardenHeight.value));

  const outOfBounds=state.zones.some(zone=>zone.x+zone.width>width+.0001||zone.y+zone.height>height+.0001);
  if(outOfBounds){
    showError("Impossible de réduire le plan : au moins une zone dépasserait. Déplace ou redimensionne d’abord les zones concernées.");
    loadPlanIntoForm();
    return;
  }

  state.gardenWidth=width;
  state.gardenHeight=height;
  persistSettings(state);
  hideError();
  render();
}

function saveZone(event){
  event.preventDefault();
  const state=settings();
  const index=state.zones.findIndex(zone=>String(zone.id)===String(dom.zoneId.value));
  if(index<0)return;

  const cropKey=dom.zoneCropKey.value;
  const zone={
    ...state.zones[index],
    name:dom.zoneName.value.trim()||"Zone",
    cropKey,
    cropCustom:cropKey==="autre"?(dom.zoneCustomCrop.value.trim()||"Autre culture"):CROP_PRESETS[cropKey].label,
    flow:Math.max(.1,num(dom.zoneFlow.value)),
    seasonMode:dom.zoneSeasonMode.value,
    kc:Math.max(0,num(dom.zoneKc.value)),
    lastWatering:dom.zoneLastWatering.value,
    finished:dom.zoneFinished.checked
  };

  state.zones[index]=normalizeZone(zone,state);
  persistSettings(state);
  selectedZoneId=state.zones[index].id;
  hideError();
  render();
}

function handleZoneListClick(event){
  const button=event.target.closest("button[data-action='watered']");
  if(!button)return;
  markZoneWatered(button.getAttribute("data-zone-id"));
}

function markZoneWatered(zoneId){
  const state=settings();
  const zone=state.zones.find(item=>String(item.id)===String(zoneId));
  if(!zone||zone.finished)return;
  zone.lastWatering=localDateString(new Date());
  persistSettings(state);
  render();
}

function deleteSelectedZone(){
  if(!selectedZoneId)return;
  const state=settings();
  const zone=state.zones.find(item=>String(item.id)===String(selectedZoneId));
  if(!zone)return;

  const confirmed=window.confirm(`Supprimer la zone « ${zone.name||"Zone"} » ? Cette action supprimera son suivi d’arrosage.`);
  if(!confirmed)return;

  state.zones=state.zones.filter(item=>String(item.id)!==String(selectedZoneId));
  selectedZoneId=state.zones[0]?.id??null;
  persistSettings(state);
  hideError();
  render();
}

function toggleDrawMode(){
  drawMode=!drawMode;
  interaction=null;
  setDrawButtonLabel();
  dom.drawModeText.textContent=drawMode?"Mode dessin actif":"Mode normal";
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
    x:rect.x,y:rect.y,width:rect.width,height:rect.height,
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

function zoneTextLayout(label,liters,rect){
  const safeWidth=Math.max(.08,rect.width-Math.min(.16,rect.width*.16));
  const maxFont=Math.min(.34,Math.max(.07,rect.height*.23));
  const litersFont=Math.min(.31,Math.max(.065,rect.height*.21));
  const labelEstimate=String(label).length*maxFont*.57;
  const litersEstimate=String(liters).length*litersFont*.55;
  const labelTextLength=labelEstimate>safeWidth?` textLength="${round(safeWidth,3)}" lengthAdjust="spacingAndGlyphs"`:"";
  const litersTextLength=litersEstimate>safeWidth?` textLength="${round(safeWidth,3)}" lengthAdjust="spacingAndGlyphs"`:"";
  const centerY=rect.y+rect.height/2;
  const gap=Math.min(.06,rect.height*.05);
  return {
    labelFont:round(maxFont,3),
    litersFont:round(litersFont,3),
    labelY:round(centerY-maxFont*.62-gap/2,3),
    litersY:round(centerY+litersFont*.62+gap/2,3),
    labelTextLength,
    litersTextLength
  };
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


function normalizeFavoriteLocation(item){
  if(!item)return null;
  const latitude=num(item.latitude);
  const longitude=num(item.longitude);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return null;
  return {
    id:String(item.id||createId()),
    name:String(item.name||"Lieu favori").trim(),
    latitude,
    longitude
  };
}

function renderLocationCard(){
  const state=settings();
  dom.currentLocationName.textContent=state.locationName||"Lieu actuel";
  const favorite=findMatchingFavorite(state);
  dom.favoriteLocationButton.textContent=favorite?"★":"☆";
  dom.favoriteLocationButton.setAttribute("aria-label",favorite?"Retirer ce lieu des favoris":"Ajouter ce lieu aux favoris");
  dom.favoriteLocationButton.title=favorite?"Retirer des favoris":"Ajouter aux favoris";
  renderFavoriteLocations(state);
}

function findMatchingFavorite(state){
  return state.favoriteLocations.find(item=>sameCoordinates(item.latitude,item.longitude,state.latitude,state.longitude));
}

function sameCoordinates(lat1,lon1,lat2,lon2){
  return Math.abs(num(lat1)-num(lat2))<.00001&&Math.abs(num(lon1)-num(lon2))<.00001;
}

function toggleCurrentLocationFavorite(){
  const state=settings();
  const existing=findMatchingFavorite(state);
  if(existing){
    state.favoriteLocations=state.favoriteLocations.filter(item=>item.id!==existing.id);
    dom.locationStatus.textContent="Lieu retiré des favoris.";
  }else{
    state.favoriteLocations.push({
      id:createId(),name:state.locationName||"Lieu favori",latitude:state.latitude,longitude:state.longitude
    });
    dom.locationStatus.textContent="Lieu ajouté aux favoris.";
  }
  persistSettings(state);
  renderLocationCard();
}

function toggleLocationSearch(){
  const willOpen=dom.locationSearchForm.hidden;
  dom.locationSearchForm.hidden=!willOpen;
  dom.toggleLocationSearchButton.textContent=willOpen?"Fermer":"Rechercher un lieu";
  if(willOpen){
    dom.locationSearchInput.focus();
  }else{
    dom.locationSearchResults.hidden=true;
    dom.locationStatus.textContent="";
  }
}

async function searchLocation(event){
  event.preventDefault();
  const query=dom.locationSearchInput.value.trim();
  if(query.length<2){
    dom.locationStatus.textContent="Saisis au moins 2 caractères pour rechercher un lieu.";
    return;
  }
  dom.locationStatus.textContent="Recherche du lieu…";
  dom.locationSearchResults.hidden=true;
  try{
    const url=new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search=new URLSearchParams({name:query,count:"6",language:"fr",format:"json"}).toString();
    const response=await fetch(url,{cache:"no-store"});
    if(!response.ok)throw new Error(`service de recherche ${response.status}`);
    const data=await response.json();
    locationSearchResults=Array.isArray(data.results)?data.results:[];
    renderLocationSearchResults();
    dom.locationStatus.textContent=locationSearchResults.length?"Choisis un résultat ci-dessous.":"Aucun lieu trouvé.";
  }catch(error){
    locationSearchResults=[];
    dom.locationStatus.textContent="Impossible de rechercher ce lieu pour le moment.";
  }
}

function renderLocationSearchResults(){
  if(!locationSearchResults.length){
    dom.locationSearchResults.innerHTML="";
    dom.locationSearchResults.hidden=true;
    return;
  }
  dom.locationSearchResults.innerHTML=locationSearchResults.map((item,index)=>{
    const parts=[item.name,item.admin1,item.country].filter(Boolean);
    const label=[...new Set(parts)].join(", ");
    return `<button type="button" class="location-result-button" data-location-index="${index}">
      <strong>${escapeHtml(item.name||"Lieu")}</strong>
      <span>${escapeHtml(label)}</span>
    </button>`;
  }).join("");
  dom.locationSearchResults.hidden=false;
}

function handleLocationSearchResultClick(event){
  const button=event.target.closest("button[data-location-index]");
  if(!button)return;
  const item=locationSearchResults[num(button.getAttribute("data-location-index"))];
  if(!item)return;
  const label=[item.name,item.admin1,item.country].filter(Boolean);
  selectLocation({name:[...new Set(label)].join(", "),latitude:item.latitude,longitude:item.longitude});
  dom.locationSearchResults.hidden=true;
  dom.locationSearchForm.hidden=true;
  dom.toggleLocationSearchButton.textContent="Rechercher un lieu";
  dom.locationSearchInput.value="";
}

function useCurrentLocation(){
  if(!navigator.geolocation){
    dom.locationStatus.textContent="La géolocalisation n’est pas disponible sur cet appareil.";
    return;
  }
  dom.locationStatus.textContent="Recherche de ta position…";
  navigator.geolocation.getCurrentPosition(
    position=>{
      selectLocation({
        name:"Ma position actuelle",
        latitude:round(position.coords.latitude,6),
        longitude:round(position.coords.longitude,6)
      });
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

function selectLocation(location){
  const state=settings();
  state.latitude=num(location.latitude);
  state.longitude=num(location.longitude);
  state.locationName=String(location.name||"Lieu actuel");
  persistSettings(state);
  weatherSelectedDate=null;
  dom.locationStatus.textContent=`Localisation utilisée : ${state.locationName}`;
  renderLocationCard();
  refresh();
}

function renderFavoriteLocations(state=settings()){
  if(!state.favoriteLocations.length){
    dom.locationFavorites.innerHTML='<span class="muted favorite-empty">Aucun</span>';
    return;
  }
  dom.locationFavorites.innerHTML=state.favoriteLocations.map(item=>`<span class="favorite-location-chip">
    <button type="button" class="favorite-select" data-favorite-action="select" data-favorite-id="${item.id}">${escapeHtml(item.name)}</button>
    <button type="button" class="favorite-remove" data-favorite-action="remove" data-favorite-id="${item.id}" aria-label="Retirer ${escapeHtml(item.name)} des favoris">×</button>
  </span>`).join("");
}

function handleFavoriteLocationClick(event){
  const button=event.target.closest("button[data-favorite-action]");
  if(!button)return;
  const state=settings();
  const favorite=state.favoriteLocations.find(item=>item.id===button.getAttribute("data-favorite-id"));
  if(!favorite)return;
  if(button.getAttribute("data-favorite-action")==="remove"){
    state.favoriteLocations=state.favoriteLocations.filter(item=>item.id!==favorite.id);
    persistSettings(state);
    dom.locationStatus.textContent="Lieu retiré des favoris.";
    renderLocationCard();
    return;
  }
  selectLocation(favorite);
}

function changePlanZoom(delta){
  setPlanZoom(planZoom+delta);
}

function setPlanZoom(value){
  planZoom=clamp(value,1,4,1);
  applyPlanZoom();
}

function applyPlanZoom(){
  if(!dom.gardenSvg)return;
  dom.gardenSvg.style.width=`${Math.round(planZoom*100)}%`;
  dom.gardenSvg.style.maxWidth="none";
  if(dom.zoomValue)dom.zoomValue.textContent=`${Math.round(planZoom*100)} %`;
  if(dom.zoomOutButton)dom.zoomOutButton.disabled=planZoom<=1;
  if(dom.zoomInButton)dom.zoomInButton.disabled=planZoom>=4;
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
function formatLongDate(value){
  return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
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
