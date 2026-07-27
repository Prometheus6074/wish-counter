(function(){
  "use strict";

  /* ---------------------------------------------------------------------
   * Constants & defaults
   * ------------------------------------------------------------------- */
  var GACHA_TYPES = ["200","301","302","400"]; // standard, character-1, weapon, character-2
  var PAGE_SIZE = 20;
  var REQUEST_DELAY_MS = 340;
  var RATE_LIMIT_WAIT_MS = 2200;
  var MAX_RETRIES = 5;
  var PRIMOGEMS_PER_WISH = 160;

  /* ---------------------------------------------------------------------
   * Motion helpers (GSAP is optional — loaded from CDN, may be unavailable
   * offline or blocked. Every call site below checks for it and falls back
   * to setting the final state instantly, so nothing depends on it working.)
   * ------------------------------------------------------------------- */
  function prefersReducedMotion(){
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function gsapReady(){
    return typeof window.gsap !== "undefined" && !prefersReducedMotion();
  }
  var lastStatValues = {}; // elId -> last displayed number, so count-up only plays on a real change
  // Animates a plain-number stat span from its previous value to newVal.
  // format defaults to fmt(); pass el's id (not the element) so it always
  // re-queries the live DOM node, since stat cards are rebuilt via innerHTML.
  function animateStatNumber(elId, newVal, format){
    var el = document.getElementById(elId);
    if(!el) return;
    format = format || fmt;
    var prev = lastStatValues[elId];
    lastStatValues[elId] = newVal;
    if(!gsapReady() || prev === undefined || prev === newVal){
      el.textContent = format(newVal);
      return;
    }
    var proxy = { v: prev };
    gsap.to(proxy, {
      v: newVal, duration: 0.7, ease: "power2.out",
      onUpdate: function(){ el.textContent = format(Math.round(proxy.v)); },
      onComplete: function(){ el.textContent = format(newVal); }
    });
  }
  var lastPityBarPct = {}; // elId -> last width%, so the pity bar only tweens on a real change
  // Eases the 5★ pity progress indicator from its previous width to the new
  // one, mirroring animateStatNumber's "tween only if it actually moved"
  // behavior. Falls back to an instant width set with zero JS dependency.
  function animatePityBar(elId, pct){
    var el = document.getElementById(elId);
    if(!el) return;
    var prev = lastPityBarPct[elId];
    lastPityBarPct[elId] = pct;
    if(!gsapReady() || prev === pct){
      el.style.width = pct + "%";
      return;
    }
    gsap.killTweensOf(el);
    gsap.fromTo(el, { width: (prev === undefined ? 0 : prev) + "%" }, { width: pct + "%", duration: 0.6, ease: "power2.out" });
  }
  // Staggered "draw-in" for a set of bar elements — scales each from 0 to
  // full width, left-anchored. Used for the Gantt chart on open.
  function animateBarsDrawIn(barEls){
    if(!gsapReady() || !barEls.length) return;
    gsap.from(barEls, {
      scaleX: 0, transformOrigin: "left center",
      duration: 0.5, ease: "power2.out", stagger: 0.025
    });
  }
  // Slides a single details panel open/closed in place, leaving every other
  // card untouched (no full re-render, so nothing else on the page flashes).
  //
  // ScrollSmoother note: animating height:0 -> "auto" changes the page's
  // total content height on every frame of the tween. ScrollTrigger watches
  // for exactly that kind of layout-size change and auto-refreshes itself
  // when it happens — and each of those refreshes briefly re-snaps
  // ScrollSmoother's transform-based scroll position, which is what reads
  // as "the whole page blinks." withScrollRefreshSuppressed() turns that
  // auto-refresh off for the duration of the tween and does exactly one
  // manual refresh once the height has actually settled, instead of one
  // (or several) mid-flight.
  function withScrollRefreshSuppressed(runTween){
    var st = window.ScrollTrigger;
    var smoothActive = document.documentElement.classList.contains("smooth-scroll-active");
    if(st && smoothActive) st.config({ autoRefreshEvents: "none" });
    runTween(function onSettled(){
      if(st && smoothActive){
        st.refresh();
        st.config({ autoRefreshEvents: "visibilitychange,DOMContentLoaded,load,resize" }); // GSAP's own default
      }
    });
  }
  function slideDetailsOpen(el){
    if(!gsapReady()){ el.style.height = "auto"; el.style.opacity = "1"; return; }
    gsap.killTweensOf(el);
    withScrollRefreshSuppressed(function(onSettled){
      gsap.fromTo(el, { height: 0, opacity: 0 }, {
        height: "auto", opacity: 1, duration: 0.36, ease: "power2.out",
        onComplete: onSettled
      });
    });
  }
  function slideDetailsClosed(el, onComplete){
    if(!gsapReady()){ el.style.height = "0"; el.style.opacity = "0"; if(onComplete) onComplete(); return; }
    gsap.killTweensOf(el);
    withScrollRefreshSuppressed(function(onSettled){
      gsap.to(el, {
        height: 0, opacity: 0, duration: 0.26, ease: "power2.in",
        onComplete: function(){ onSettled(); if(onComplete) onComplete(); }
      });
    });
  }

  // Buttery page-level scroll via GSAP's ScrollSmoother. Same fallback
  // philosophy as the rest of this block: if ScrollTrigger/ScrollSmoother
  // didn't load (CDN blocked/offline) or the person prefers reduced
  // motion, this simply never runs and #smooth-wrapper/#smooth-content
  // stay display:contents (see CSS), so the page just scrolls natively
  // with zero visual difference. Only on success does the .smooth-scroll-
  // active class go on <html>, which is what turns on the fixed/transform
  // layout ScrollSmoother actually needs.
  function initSmoothScroll(){
    if(prefersReducedMotion()) return;
    if(typeof window.gsap === "undefined") return;
    if(typeof window.ScrollTrigger === "undefined" || typeof window.ScrollSmoother === "undefined") return;
    var wrapperEl = document.getElementById("smooth-wrapper");
    var contentEl = document.getElementById("smooth-content");
    if(!wrapperEl || !contentEl) return;
    try{
      gsap.registerPlugin(ScrollTrigger, ScrollSmoother);
      ScrollSmoother.create({
        wrapper: wrapperEl,
        content: contentEl,
        smooth: 1.1,        // higher = more glide/lag behind the actual scroll input
        effects: false,     // no data-speed parallax layers in this app, keep it off for perf
        normalizeScroll: true
      });
      document.documentElement.classList.add("smooth-scroll-active");
    }catch(e){
      // Leave native scroll in place if anything about init went wrong.
    }
  }
  // This script tag sits at the end of <body>, so the DOM (including
  // #smooth-wrapper/#smooth-content) already exists — safe to call now
  // rather than waiting on a DOMContentLoaded listener.
  initSmoothScroll();

  // Fades the topbar's title/UID out once the page has scrolled past the
  // very top, back in once scrolled back up — via the .scrolled class added
  // above, which reuses .topbar-title/.topbar-uid's existing .12s opacity
  // transition rather than a new one. The hamburger icon isn't part of
  // either element, so it stays visible throughout.
  // Plain native scroll listener: works the same whether ScrollSmoother is
  // active or not, since normalizeScroll:true (see initSmoothScroll above)
  // keeps window.scrollY in sync either way.
  (function initTopbarScrollFade(){
    var topbarEl = document.querySelector(".topbar");
    if(!topbarEl) return;
    var SCROLL_HIDE_THRESHOLD = 24; // px scrolled before title/UID start fading out
    var ticking = false;
    function updateTopbarScrollState(){
      ticking = false;
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      topbarEl.classList.toggle("scrolled", y > SCROLL_HIDE_THRESHOLD);
    }
    window.addEventListener("scroll", function(){
      if(!ticking){
        ticking = true;
        requestAnimationFrame(updateTopbarScrollState);
      }
    }, { passive: true });
    updateTopbarScrollState(); // correct initial state if the page loads mid-scroll
  })();

  var DEFAULT_STD_CHARACTERS = ["Jean","Diluc","Mona","Keqing","Qiqi","Tighnari","Dehya","Yumemizuki Mizuki"];
  var DEFAULT_STD_WEAPONS = ["Aquila Favonia","Skyward Blade","Wolf's Gravestone","Skyward Pride","Primordial Jade Winged-Spear","Skyward Spine","Amos' Bow","Skyward Harp","Lost Prayer to the Sacred Winds","Skyward Atlas"];
  var DEFAULT_PROXIES = [
    "", // empty string = try direct fetch, no proxy
    "https://corsproxy.io/?url=",
    "https://api.allorigins.win/raw?url="
  ];

  var STORAGE_DATA_KEY = "wishCounter.data.v1";
  var STORAGE_SETTINGS_KEY = "wishCounter.settings.v1";

  var BANNER_META = {
    "character": { label:"Character Event", pity5:90, pity4:10, types:["301","400"], kind:"limited" },
    "weapon":    { label:"Weapon Event",    pity5:80, pity4:10, types:["302"],       kind:"limited" },
    "standard":  { label:"Standard",        pity5:90, pity4:10, types:["200"],       kind:"standard" }
  };

  /* ---------------------------------------------------------------------
   * Weapons reference database
   * name, type, rarity, atk (approx. Lv90/max base ATK), secondary (substat)
   * Covers the weapons obtainable from wishes (standard 3★ pool, plus the
   * 4★ and 5★ pool shared across the Character, Weapon, and Standard
   * banners). Base ATK values are representative — a small group of
   * premium-substat 5★s (Jade Cutter/Winged-Spear, Key of Khaj-Nisut,
   * Haran Geppaku Futsu, Light of Foliar Incision) use a lower base-ATK
   * curve in exchange for a stronger substat, same as in-game.
   * ------------------------------------------------------------------- */
  var DEFAULT_WEAPON_DB = [
    // Swords
    { name:"Absolution", type:"Sword", rarity:5, atk:674, secondary:"CRIT DMG 44.1%" },
    { name:"Aquila Favonia", type:"Sword", rarity:5, atk:674, secondary:"Physical DMG Bonus 41.3%" },
    { name:"Athame Artis", type:"Sword", rarity:5, atk:608, secondary:"CRIT Rate 33.1%" },
    { name:"Azurelight", type:"Sword", rarity:5, atk:674, secondary:"CRIT Rate 22.1%" },
    { name:"Freedom-Sworn", type:"Sword", rarity:5, atk:608, secondary:"Elemental Mastery 198" },
    { name:"Haran Geppaku Futsu", type:"Sword", rarity:5, atk:608, secondary:"CRIT Rate 33.1%" },
    { name:"Key of Khaj-Nisut", type:"Sword", rarity:5, atk:542, secondary:"HP 66.2%" },
    { name:"Light of Foliar Incision", type:"Sword", rarity:5, atk:542, secondary:"CRIT DMG 88.2%" },
    { name:"Lightbearing Moonshard", type:"Sword", rarity:5, atk:542, secondary:"CRIT DMG 88.2%" },
    { name:"Mistsplitter Reforged", type:"Sword", rarity:5, atk:674, secondary:"CRIT DMG 44.1%" },
    { name:"Peak Patrol Song", type:"Sword", rarity:5, atk:542, secondary:"DEF 82.7%" },
    { name:"Primordial Jade Cutter", type:"Sword", rarity:5, atk:542, secondary:"CRIT Rate 44.1%" },
    { name:"Skyward Blade", type:"Sword", rarity:5, atk:608, secondary:"Energy Recharge 55.1%" },
    { name:"Splendor of Tranquil Waters", type:"Sword", rarity:5, atk:542, secondary:"CRIT DMG 88.2%" },
    { name:"Summit Shaper", type:"Sword", rarity:5, atk:608, secondary:"ATK 49.6%" },
    { name:"Uraku Misugiri", type:"Sword", rarity:5, atk:542, secondary:"CRIT DMG 88.2%" },
    { name:"Amenoma Kageuchi", type:"Sword", rarity:4, atk:454, secondary:"ATK 55.1%" },
    { name:"Blackcliff Longsword", type:"Sword", rarity:4, atk:565, secondary:"CRIT DMG 36.8%" },
    { name:"Calamity of Eshu", type:"Sword", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Cinnabar Spindle", type:"Sword", rarity:4, atk:454, secondary:"DEF 69%" },
    { name:"Favonius Sword", type:"Sword", rarity:4, atk:454, secondary:"Energy Recharge 61.3%" },
    { name:"Festering Desire", type:"Sword", rarity:4, atk:510, secondary:"Energy Recharge 45.9%" },
    { name:"Finale of the Deep", type:"Sword", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Fleuve Cendre Ferryman", type:"Sword", rarity:4, atk:510, secondary:"Energy Recharge 45.9%" },
    { name:"Flute of Ezpitzal", type:"Sword", rarity:4, atk:454, secondary:"DEF 69%" },
    { name:"Iron Sting", type:"Sword", rarity:4, atk:510, secondary:"Elemental Mastery 165" },
    { name:"Kagotsurube Isshin", type:"Sword", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Lion's Roar", type:"Sword", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Moonweaver's Dawn", type:"Sword", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Prototype Rancour", type:"Sword", rarity:4, atk:565, secondary:"Physical DMG Bonus 34.5%" },
    { name:"Royal Longsword", type:"Sword", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Sacrificial Sword", type:"Sword", rarity:4, atk:454, secondary:"Energy Recharge 61.3%" },
    { name:"Sapwood Blade", type:"Sword", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"Sturdy Bone", type:"Sword", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Sword of Descension", type:"Sword", rarity:4, atk:440, secondary:"ATK 35.2%" },
    { name:"The Alley Flash", type:"Sword", rarity:4, atk:620, secondary:"Elemental Mastery 55" },
    { name:"The Black Sword", type:"Sword", rarity:4, atk:510, secondary:"CRIT Rate 27.6%" },
    { name:"The Dockhand's Assistant", type:"Sword", rarity:4, atk:510, secondary:"HP 41.3%" },
    { name:"The Flute", type:"Sword", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Toukabou Shigure", type:"Sword", rarity:4, atk:510, secondary:"Elemental Mastery 165" },
    { name:"Wolf-Fang", type:"Sword", rarity:4, atk:510, secondary:"CRIT Rate 27.6%" },
    { name:"Xiphos' Moonlight", type:"Sword", rarity:4, atk:510, secondary:"Elemental Mastery 165" },
    { name:"Cool Steel", type:"Sword", rarity:3, atk:401, secondary:"ATK 35.2%" },
    { name:"Dark Iron Sword", type:"Sword", rarity:3, atk:401, secondary:"Elemental Mastery 141" },
    { name:"Fillet Blade", type:"Sword", rarity:3, atk:401, secondary:"ATK 35.2%" },
    { name:"Harbinger of Dawn", type:"Sword", rarity:3, atk:401, secondary:"CRIT DMG 46.9%" },
    { name:"Skyrider Sword", type:"Sword", rarity:3, atk:354, secondary:"Energy Recharge 52.1%" },
    { name:"Traveler's Handy Sword", type:"Sword", rarity:3, atk:448, secondary:"DEF 29.3%" },
    { name:"Silver Sword", type:"Sword", rarity:2, atk:243, secondary:"-" },
    { name:"Dull Blade", type:"Sword", rarity:1, atk:185, secondary:"-" },
    // Claymores
    { name:"A Teaspoon of Transcendence", type:"Claymore", rarity:5, atk:674, secondary:"CRIT DMG 44.1%" },
    { name:"A Thousand Blazing Suns", type:"Claymore", rarity:5, atk:741, secondary:"CRIT Rate 11%" },
    { name:"Beacon of the Reed Sea", type:"Claymore", rarity:5, atk:608, secondary:"CRIT Rate 33.1%" },
    { name:"Fang of the Mountain King", type:"Claymore", rarity:5, atk:741, secondary:"CRIT Rate 11%" },
    { name:"Gest of the Mighty Wolf", type:"Claymore", rarity:5, atk:608, secondary:"CRIT Rate 33.1%" },
    { name:"Redhorn Stonethresher", type:"Claymore", rarity:5, atk:542, secondary:"CRIT DMG 88.2%" },
    { name:"Skyward Pride", type:"Claymore", rarity:5, atk:674, secondary:"Energy Recharge 36.8%" },
    { name:"Song of Broken Pines", type:"Claymore", rarity:5, atk:741, secondary:"Physical DMG Bonus 20.7%" },
    { name:"The Unforged", type:"Claymore", rarity:5, atk:608, secondary:"ATK 49.6%" },
    { name:"Verdict", type:"Claymore", rarity:5, atk:674, secondary:"CRIT Rate 22.1%" },
    { name:"Wolf's Gravestone", type:"Claymore", rarity:5, atk:608, secondary:"ATK 49.6%" },
    { name:"Akuoumaru", type:"Claymore", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Blackcliff Slasher", type:"Claymore", rarity:4, atk:510, secondary:"CRIT DMG 55.1%" },
    { name:"Earth Shaker", type:"Claymore", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Favonius Greatsword", type:"Claymore", rarity:4, atk:454, secondary:"Energy Recharge 61.3%" },
    { name:"Flame-Forged Insight", type:"Claymore", rarity:4, atk:510, secondary:"Elemental Mastery 165" },
    { name:"Forest Regalia", type:"Claymore", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"Fruitful Hook", type:"Claymore", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Katsuragikiri Nagamasa", type:"Claymore", rarity:4, atk:510, secondary:"Energy Recharge 45.9%" },
    { name:"Lithic Blade", type:"Claymore", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Luxurious Sea-Lord", type:"Claymore", rarity:4, atk:454, secondary:"ATK 55.1%" },
    { name:"Mailed Flower", type:"Claymore", rarity:4, atk:565, secondary:"Elemental Mastery 110" },
    { name:"Makhaira Aquamarine", type:"Claymore", rarity:4, atk:510, secondary:"Elemental Mastery 165" },
    { name:"Portable Power Saw", type:"Claymore", rarity:4, atk:454, secondary:"HP 55.1%" },
    { name:"Prototype Archaic", type:"Claymore", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Rainslasher", type:"Claymore", rarity:4, atk:510, secondary:"Elemental Mastery 165" },
    { name:"Royal Greatsword", type:"Claymore", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Sacrificial Greatsword", type:"Claymore", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"Serpent Spine", type:"Claymore", rarity:4, atk:510, secondary:"CRIT Rate 27.6%" },
    { name:"Snow-Tombed Starsilver", type:"Claymore", rarity:4, atk:565, secondary:"Physical DMG Bonus 34.5%" },
    { name:"Talking Stick", type:"Claymore", rarity:4, atk:565, secondary:"CRIT Rate 18.4%" },
    { name:"The Bell", type:"Claymore", rarity:4, atk:510, secondary:"HP 41.3%" },
    { name:"Tidal Shadow", type:"Claymore", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Ultimate Overlord's Mega Magic Sword", type:"Claymore", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"Whiteblind", type:"Claymore", rarity:4, atk:510, secondary:"DEF 51.7%" },
    { name:"Bloodtainted Greatsword", type:"Claymore", rarity:3, atk:354, secondary:"Elemental Mastery 187" },
    { name:"Debate Club", type:"Claymore", rarity:3, atk:401, secondary:"ATK 35.2%" },
    { name:"Ferrous Shadow", type:"Claymore", rarity:3, atk:401, secondary:"HP 35.2%" },
    { name:"Skyrider Greatsword", type:"Claymore", rarity:3, atk:401, secondary:"Physical DMG Bonus 43.9%" },
    { name:"White Iron Greatsword", type:"Claymore", rarity:3, atk:401, secondary:"DEF 43.9%" },
    { name:"Old Merc's Pal", type:"Claymore", rarity:2, atk:243, secondary:"-" },
    { name:"Waster Greatsword", type:"Claymore", rarity:1, atk:185, secondary:"-" },
    // Polearms
    { name:"Bloodsoaked Ruins", type:"Polearm", rarity:5, atk:674, secondary:"CRIT Rate 22.1%" },
    { name:"Calamity Queller", type:"Polearm", rarity:5, atk:741, secondary:"ATK 16.5%" },
    { name:"Crimson Moon's Semblance", type:"Polearm", rarity:5, atk:674, secondary:"CRIT Rate 22.1%" },
    { name:"Disaster and Remorse", type:"Polearm", rarity:5, atk:674, secondary:"CRIT Rate 22.1%" },
    { name:"Engulfing Lightning", type:"Polearm", rarity:5, atk:608, secondary:"Energy Recharge 55.1%" },
    { name:"Fractured Halo", type:"Polearm", rarity:5, atk:608, secondary:"CRIT DMG 66.2%" },
    { name:"Lumidouce Elegy", type:"Polearm", rarity:5, atk:608, secondary:"CRIT Rate 33.1%" },
    { name:"Primordial Jade Winged-Spear", type:"Polearm", rarity:5, atk:674, secondary:"CRIT Rate 22.1%" },
    { name:"Skyward Spine", type:"Polearm", rarity:5, atk:674, secondary:"Energy Recharge 36.8%" },
    { name:"Staff of Homa", type:"Polearm", rarity:5, atk:608, secondary:"CRIT DMG 66.2%" },
    { name:"Staff of the Scarlet Sands", type:"Polearm", rarity:5, atk:542, secondary:"CRIT Rate 44.1%" },
    { name:"Symphonist of Scents", type:"Polearm", rarity:5, atk:608, secondary:"CRIT DMG 66.2%" },
    { name:"Vortex Vanquisher", type:"Polearm", rarity:5, atk:608, secondary:"ATK 49.6%" },
    { name:"Ballad of the Fjords", type:"Polearm", rarity:4, atk:510, secondary:"CRIT Rate 27.6%" },
    { name:"Blackcliff Pole", type:"Polearm", rarity:4, atk:510, secondary:"CRIT DMG 55.1%" },
    { name:"Crescent Pike", type:"Polearm", rarity:4, atk:565, secondary:"Physical DMG Bonus 34.5%" },
    { name:"Deathmatch", type:"Polearm", rarity:4, atk:454, secondary:"CRIT Rate 36.8%" },
    { name:"Dialogues of the Desert Sages", type:"Polearm", rarity:4, atk:510, secondary:"HP 41.3%" },
    { name:"Dragon's Bane", type:"Polearm", rarity:4, atk:454, secondary:"Elemental Mastery 221" },
    { name:"Dragonspine Spear", type:"Polearm", rarity:4, atk:454, secondary:"Physical DMG Bonus 69%" },
    { name:"Favonius Lance", type:"Polearm", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"Footprint of the Rainbow", type:"Polearm", rarity:4, atk:510, secondary:"DEF 51.7%" },
    { name:"Kitain Cross Spear", type:"Polearm", rarity:4, atk:565, secondary:"Elemental Mastery 110" },
    { name:"Lithic Spear", type:"Polearm", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Missive Windspear", type:"Polearm", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Moonpiercer", type:"Polearm", rarity:4, atk:565, secondary:"Elemental Mastery 110" },
    { name:"Mountain-Bracing Bolt", type:"Polearm", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"Prospector's Drill", type:"Polearm", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Prototype Starglitter", type:"Polearm", rarity:4, atk:510, secondary:"Energy Recharge 45.9%" },
    { name:"Rightful Reward", type:"Polearm", rarity:4, atk:565, secondary:"HP 27.6%" },
    { name:"Royal Spear", type:"Polearm", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Sacrificer's Staff", type:"Polearm", rarity:4, atk:620, secondary:"CRIT Rate 9.2%" },
    { name:"Tamayuratei no Ohanashi", type:"Polearm", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"The Catch", type:"Polearm", rarity:4, atk:510, secondary:"Energy Recharge 45.9%" },
    { name:"Wavebreaker's Fin", type:"Polearm", rarity:4, atk:620, secondary:"ATK 13.8%" },
    { name:"Black Tassel", type:"Polearm", rarity:3, atk:354, secondary:"HP 46.9%" },
    { name:"Halberd", type:"Polearm", rarity:3, atk:448, secondary:"ATK 23.5%" },
    { name:"White Tassel", type:"Polearm", rarity:3, atk:401, secondary:"CRIT Rate 23.4%" },
    { name:"Iron Point", type:"Polearm", rarity:2, atk:243, secondary:"-" },
    { name:"Beginner's Protector", type:"Polearm", rarity:1, atk:185, secondary:"-" },
    // Catalysts
    { name:"A Thousand Floating Dreams", type:"Catalyst", rarity:5, atk:542, secondary:"Elemental Mastery 265" },
    { name:"Angelos' Heptades", type:"Catalyst", rarity:5, atk:741, secondary:"ATK 16.5%" },
    { name:"Cashflow Supervision", type:"Catalyst", rarity:5, atk:674, secondary:"CRIT Rate 22.1%" },
    { name:"Crane's Echoing Call", type:"Catalyst", rarity:5, atk:741, secondary:"ATK 16.5%" },
    { name:"Everlasting Moonglow", type:"Catalyst", rarity:5, atk:608, secondary:"HP 49.6%" },
    { name:"Jadefall's Splendor", type:"Catalyst", rarity:5, atk:608, secondary:"HP 49.6%" },
    { name:"Kagura's Verity", type:"Catalyst", rarity:5, atk:608, secondary:"CRIT DMG 66.2%" },
    { name:"Lost Prayer to the Sacred Winds", type:"Catalyst", rarity:5, atk:608, secondary:"CRIT Rate 33.1%" },
    { name:"Memory of Dust", type:"Catalyst", rarity:5, atk:608, secondary:"ATK 49.6%" },
    { name:"Nightweaver's Looking Glass", type:"Catalyst", rarity:5, atk:542, secondary:"Elemental Mastery 265" },
    { name:"Nocturne's Curtain Call", type:"Catalyst", rarity:5, atk:542, secondary:"CRIT DMG 88.2%" },
    { name:"Reliquary of Truth", type:"Catalyst", rarity:5, atk:542, secondary:"CRIT DMG 88.2%" },
    { name:"Skyward Atlas", type:"Catalyst", rarity:5, atk:674, secondary:"ATK 33.1%" },
    { name:"Starcaller's Watch", type:"Catalyst", rarity:5, atk:542, secondary:"Elemental Mastery 265" },
    { name:"Sunny Morning Sleep-In", type:"Catalyst", rarity:5, atk:542, secondary:"Elemental Mastery 265" },
    { name:"Surf's Up", type:"Catalyst", rarity:5, atk:542, secondary:"CRIT DMG 88.2%" },
    { name:"Tome of the Eternal Flow", type:"Catalyst", rarity:5, atk:542, secondary:"CRIT DMG 88.2%" },
    { name:"Tulaytullah's Remembrance", type:"Catalyst", rarity:5, atk:674, secondary:"CRIT DMG 44.1%" },
    { name:"Vivid Notions", type:"Catalyst", rarity:5, atk:674, secondary:"CRIT DMG 44.1%" },
    { name:"Ash-Graven Drinking Horn", type:"Catalyst", rarity:4, atk:510, secondary:"HP 41.3%" },
    { name:"Ballad of the Boundless Blue", type:"Catalyst", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"Blackcliff Agate", type:"Catalyst", rarity:4, atk:510, secondary:"CRIT DMG 55.1%" },
    { name:"Dawning Frost", type:"Catalyst", rarity:4, atk:510, secondary:"CRIT DMG 55.1%" },
    { name:"Dodoco Tales", type:"Catalyst", rarity:4, atk:454, secondary:"ATK 55.1%" },
    { name:"Etherlight Spindlelute", type:"Catalyst", rarity:4, atk:510, secondary:"Energy Recharge 45.9%" },
    { name:"Eye of Perception", type:"Catalyst", rarity:4, atk:454, secondary:"ATK 55.1%" },
    { name:"Favonius Codex", type:"Catalyst", rarity:4, atk:510, secondary:"Energy Recharge 45.9%" },
    { name:"Flowing Purity", type:"Catalyst", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Frostbearer", type:"Catalyst", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Fruit of Fulfillment", type:"Catalyst", rarity:4, atk:510, secondary:"Energy Recharge 45.9%" },
    { name:"Hakushin Ring", type:"Catalyst", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"Mappa Mare", type:"Catalyst", rarity:4, atk:565, secondary:"Elemental Mastery 110" },
    { name:"Oathsworn Eye", type:"Catalyst", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Prototype Amber", type:"Catalyst", rarity:4, atk:510, secondary:"HP 41.3%" },
    { name:"Ring of Yaxche", type:"Catalyst", rarity:4, atk:510, secondary:"HP 41.3%" },
    { name:"Royal Grimoire", type:"Catalyst", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Sacrificial Fragments", type:"Catalyst", rarity:4, atk:454, secondary:"Elemental Mastery 221" },
    { name:"Sacrificial Jade", type:"Catalyst", rarity:4, atk:454, secondary:"CRIT Rate 36.8%" },
    { name:"Solar Pearl", type:"Catalyst", rarity:4, atk:510, secondary:"CRIT Rate 27.6%" },
    { name:"The Widsith", type:"Catalyst", rarity:4, atk:510, secondary:"CRIT DMG 55.1%" },
    { name:"Wandering Evenstar", type:"Catalyst", rarity:4, atk:510, secondary:"Elemental Mastery 165" },
    { name:"Waveriding Whirl", type:"Catalyst", rarity:4, atk:454, secondary:"Energy Recharge 61.3%" },
    { name:"Wine and Song", type:"Catalyst", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"Emerald Orb", type:"Catalyst", rarity:3, atk:448, secondary:"Elemental Mastery 94" },
    { name:"Magic Guide", type:"Catalyst", rarity:3, atk:354, secondary:"Elemental Mastery 187" },
    { name:"Otherworldly Story", type:"Catalyst", rarity:3, atk:401, secondary:"Energy Recharge 39%" },
    { name:"Thrilling Tales of Dragon Slayers", type:"Catalyst", rarity:3, atk:401, secondary:"HP 35.2%" },
    { name:"Twin Nephrite", type:"Catalyst", rarity:3, atk:448, secondary:"CRIT Rate 15.6%" },
    { name:"Pocket Grimoire", type:"Catalyst", rarity:2, atk:243, secondary:"-" },
    { name:"Apprentice's Notes", type:"Catalyst", rarity:1, atk:185, secondary:"-" },
    // Bows
    { name:"Amos' Bow", type:"Bow", rarity:5, atk:608, secondary:"ATK 49.6%" },
    { name:"Aqua Simulacra", type:"Bow", rarity:5, atk:542, secondary:"CRIT DMG 88.2%" },
    { name:"Astral Vulture's Crimson Plumage", type:"Bow", rarity:5, atk:608, secondary:"CRIT DMG 66.2%" },
    { name:"Elegy for the End", type:"Bow", rarity:5, atk:608, secondary:"Energy Recharge 55.1%" },
    { name:"Golden Frostbound Oath", type:"Bow", rarity:5, atk:542, secondary:"CRIT DMG 88.2%" },
    { name:"Hunter's Path", type:"Bow", rarity:5, atk:542, secondary:"CRIT Rate 44.1%" },
    { name:"Polar Star", type:"Bow", rarity:5, atk:608, secondary:"CRIT Rate 33.1%" },
    { name:"Silvershower Heartstrings", type:"Bow", rarity:5, atk:542, secondary:"HP 66.2%" },
    { name:"Skyward Harp", type:"Bow", rarity:5, atk:674, secondary:"CRIT Rate 22.1%" },
    { name:"The Daybreak Chronicles", type:"Bow", rarity:5, atk:674, secondary:"CRIT DMG 44.1%" },
    { name:"The First Great Magic", type:"Bow", rarity:5, atk:608, secondary:"CRIT DMG 66.2%" },
    { name:"Thundering Pulse", type:"Bow", rarity:5, atk:608, secondary:"CRIT DMG 66.2%" },
    { name:"Alley Hunter", type:"Bow", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Blackcliff Warbow", type:"Bow", rarity:4, atk:565, secondary:"CRIT DMG 36.8%" },
    { name:"Chain Breaker", type:"Bow", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Cloudforged", type:"Bow", rarity:4, atk:510, secondary:"Elemental Mastery 165" },
    { name:"Compound Bow", type:"Bow", rarity:4, atk:454, secondary:"Physical DMG Bonus 69%" },
    { name:"End of the Line", type:"Bow", rarity:4, atk:510, secondary:"Energy Recharge 45.9%" },
    { name:"Fading Twilight", type:"Bow", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"Favonius Warbow", type:"Bow", rarity:4, atk:454, secondary:"Energy Recharge 61.3%" },
    { name:"Flower-Wreathed Feathers", type:"Bow", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Hamayumi", type:"Bow", rarity:4, atk:454, secondary:"ATK 55.1%" },
    { name:"Ibis Piercer", type:"Bow", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"King's Squire", type:"Bow", rarity:4, atk:454, secondary:"ATK 55.1%" },
    { name:"Mitternachts Waltz", type:"Bow", rarity:4, atk:510, secondary:"Physical DMG Bonus 51.7%" },
    { name:"Mouun's Moon", type:"Bow", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Predator", type:"Bow", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Prototype Crescent", type:"Bow", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Rainbow Serpent's Rain Bow", type:"Bow", rarity:4, atk:510, secondary:"Energy Recharge 45.9%" },
    { name:"Range Gauge", type:"Bow", rarity:4, atk:565, secondary:"ATK 27.6%" },
    { name:"Royal Bow", type:"Bow", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Rust", type:"Bow", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"Sacrificial Bow", type:"Bow", rarity:4, atk:565, secondary:"Energy Recharge 30.6%" },
    { name:"Scion of the Blazing Sun", type:"Bow", rarity:4, atk:565, secondary:"CRIT Rate 18.4%" },
    { name:"Sequence of Solitude", type:"Bow", rarity:4, atk:510, secondary:"HP 41.3%" },
    { name:"Song of Stillness", type:"Bow", rarity:4, atk:510, secondary:"ATK 41.3%" },
    { name:"The Stringless", type:"Bow", rarity:4, atk:510, secondary:"Elemental Mastery 165" },
    { name:"The Viridescent Hunt", type:"Bow", rarity:4, atk:510, secondary:"CRIT Rate 27.6%" },
    { name:"Windblume Ode", type:"Bow", rarity:4, atk:510, secondary:"Elemental Mastery 165" },
    { name:"Messenger", type:"Bow", rarity:3, atk:448, secondary:"CRIT DMG 31.2%" },
    { name:"Raven Bow", type:"Bow", rarity:3, atk:448, secondary:"Elemental Mastery 94" },
    { name:"Recurve Bow", type:"Bow", rarity:3, atk:354, secondary:"HP 46.9%" },
    { name:"Sharpshooter's Oath", type:"Bow", rarity:3, atk:401, secondary:"CRIT DMG 46.9%" },
    { name:"Slingshot", type:"Bow", rarity:3, atk:354, secondary:"CRIT Rate 31.2%" },
    { name:"Seasoned Hunter's Bow", type:"Bow", rarity:2, atk:243, secondary:"-" },
    { name:"Hunter's Bow", type:"Bow", rarity:1, atk:185, secondary:"-" }
  ];

  // Give every seed weapon a stable id (used to locate a row for edit/delete
  // regardless of how the table is currently sorted or filtered).
  DEFAULT_WEAPON_DB.forEach(function(w){ w.id = "w_" + w.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"); });

  var STORAGE_WEAPONS_KEY = "wishCounter.weapons.v1";

  /* Character Database */
  var DEFAULT_CHARACTER_DB = [
    // Pyro
    { name:"Arlecchino", element:"Pyro", weapon:"Polearm", rarity:5 },
    { name:"Dehya", element:"Pyro", weapon:"Claymore", rarity:5 },
    { name:"Diluc", element:"Pyro", weapon:"Claymore", rarity:5 },
    { name:"Durin", element:"Pyro", weapon:"Sword", rarity:5 },
    { name:"Hu Tao", element:"Pyro", weapon:"Polearm", rarity:5 },
    { name:"Klee", element:"Pyro", weapon:"Catalyst", rarity:5 },
    { name:"Lyney", element:"Pyro", weapon:"Bow", rarity:5 },
    { name:"Mavuika", element:"Pyro", weapon:"Claymore", rarity:5 },
    { name:"Nicole", element:"Pyro", weapon:"Catalyst", rarity:5 },
    { name:"Yoimiya", element:"Pyro", weapon:"Bow", rarity:5 },
    { name:"Amber", element:"Pyro", weapon:"Bow", rarity:4 },
    { name:"Bennett", element:"Pyro", weapon:"Sword", rarity:4 },
    { name:"Chevreuse", element:"Pyro", weapon:"Polearm", rarity:4 },
    { name:"Gaming", element:"Pyro", weapon:"Claymore", rarity:4 },
    { name:"Thoma", element:"Pyro", weapon:"Polearm", rarity:4 },
    { name:"Xiangling", element:"Pyro", weapon:"Polearm", rarity:4 },
    { name:"Xinyan", element:"Pyro", weapon:"Claymore", rarity:4 },
    { name:"Yanfei", element:"Pyro", weapon:"Catalyst", rarity:4 },
    // Hydro
    { name:"Columbina", element:"Hydro", weapon:"Catalyst", rarity:5 },
    { name:"Furina", element:"Hydro", weapon:"Sword", rarity:5 },
    { name:"Kamisato Ayato", element:"Hydro", weapon:"Sword", rarity:5 },
    { name:"Mona", element:"Hydro", weapon:"Catalyst", rarity:5 },
    { name:"Mualani", element:"Hydro", weapon:"Catalyst", rarity:5 },
    { name:"Neuvillette", element:"Hydro", weapon:"Catalyst", rarity:5 },
    { name:"Nilou", element:"Hydro", weapon:"Sword", rarity:5 },
    { name:"Sangonomiya Kokomi", element:"Hydro", weapon:"Catalyst", rarity:5 },
    { name:"Sigewinne", element:"Hydro", weapon:"Bow", rarity:5 },
    { name:"Tartaglia", element:"Hydro", weapon:"Bow", rarity:5 },
    { name:"Yelan", element:"Hydro", weapon:"Bow", rarity:5 },
    { name:"Aino", element:"Hydro", weapon:"Claymore", rarity:4 },
    { name:"Barbara", element:"Hydro", weapon:"Catalyst", rarity:4 },
    { name:"Candace", element:"Hydro", weapon:"Polearm", rarity:4 },
    { name:"Dahlia", element:"Hydro", weapon:"Sword", rarity:4 },
    { name:"Xingqiu", element:"Hydro", weapon:"Sword", rarity:4 },
    // Anemo
    { name:"Chasca", element:"Anemo", weapon:"Bow", rarity:5 },
    { name:"Jean", element:"Anemo", weapon:"Sword", rarity:5 },
    { name:"Kaedehara Kazuha", element:"Anemo", weapon:"Sword", rarity:5 },
    { name:"Varka", element:"Anemo", weapon:"Claymore", rarity:5 },
    { name:"Venti", element:"Anemo", weapon:"Bow", rarity:5 },
    { name:"Wanderer", element:"Anemo", weapon:"Catalyst", rarity:5 },
    { name:"Xianyun", element:"Anemo", weapon:"Catalyst", rarity:5 },
    { name:"Xiao", element:"Anemo", weapon:"Polearm", rarity:5 },
    { name:"Yumemizuki Mizuki", element:"Anemo", weapon:"Catalyst", rarity:5 },
    { name:"Faruzan", element:"Anemo", weapon:"Bow", rarity:4 },
    { name:"Ifa", element:"Anemo", weapon:"Catalyst", rarity:4 },
    { name:"Jahoda", element:"Anemo", weapon:"Bow", rarity:4 },
    { name:"Lan Yan", element:"Anemo", weapon:"Catalyst", rarity:4 },
    { name:"Lynette", element:"Anemo", weapon:"Sword", rarity:4 },
    { name:"Prune", element:"Anemo", weapon:"Catalyst", rarity:4 },
    { name:"Sayu", element:"Anemo", weapon:"Claymore", rarity:4 },
    { name:"Shikanoin Heizou", element:"Anemo", weapon:"Catalyst", rarity:4 },
    { name:"Sucrose", element:"Anemo", weapon:"Catalyst", rarity:4 },
    // Electro
    { name:"Clorinde", element:"Electro", weapon:"Sword", rarity:5 },
    { name:"Cyno", element:"Electro", weapon:"Polearm", rarity:5 },
    { name:"Flins", element:"Electro", weapon:"Polearm", rarity:5 },
    { name:"Ineffa", element:"Electro", weapon:"Polearm", rarity:5 },
    { name:"Keqing", element:"Electro", weapon:"Sword", rarity:5 },
    { name:"Raiden Shogun", element:"Electro", weapon:"Polearm", rarity:5 },
    { name:"Varesa", element:"Electro", weapon:"Catalyst", rarity:5 },
    { name:"Yae Miko", element:"Electro", weapon:"Catalyst", rarity:5 },
    { name:"Beidou", element:"Electro", weapon:"Claymore", rarity:4 },
    { name:"Dori", element:"Electro", weapon:"Claymore", rarity:4 },
    { name:"Fischl", element:"Electro", weapon:"Bow", rarity:4 },
    { name:"Iansan", element:"Electro", weapon:"Polearm", rarity:4 },
    { name:"Kujou Sara", element:"Electro", weapon:"Bow", rarity:4 },
    { name:"Kuki Shinobu", element:"Electro", weapon:"Sword", rarity:4 },
    { name:"Lisa", element:"Electro", weapon:"Catalyst", rarity:4 },
    { name:"Ororon", element:"Electro", weapon:"Bow", rarity:4 },
    { name:"Razor", element:"Electro", weapon:"Claymore", rarity:4 },
    { name:"Sethos", element:"Electro", weapon:"Bow", rarity:4 },
    // Dendro
    { name:"Alhaitham", element:"Dendro", weapon:"Sword", rarity:5 },
    { name:"Baizhu", element:"Dendro", weapon:"Catalyst", rarity:5 },
    { name:"Emilie", element:"Dendro", weapon:"Polearm", rarity:5 },
    { name:"Kinich", element:"Dendro", weapon:"Claymore", rarity:5 },
    { name:"Lauma", element:"Dendro", weapon:"Catalyst", rarity:5 },
    { name:"Nahida", element:"Dendro", weapon:"Catalyst", rarity:5 },
    { name:"Nefer", element:"Dendro", weapon:"Catalyst", rarity:5 },
    { name:"Tighnari", element:"Dendro", weapon:"Bow", rarity:5 },
    { name:"Collei", element:"Dendro", weapon:"Bow", rarity:4 },
    { name:"Kaveh", element:"Dendro", weapon:"Claymore", rarity:4 },
    { name:"Kirara", element:"Dendro", weapon:"Sword", rarity:4 },
    { name:"Yaoyao", element:"Dendro", weapon:"Polearm", rarity:4 },
    // Cryo
    { name:"Aloy", element:"Cryo", weapon:"Bow", rarity:5 },
    { name:"Citlali", element:"Cryo", weapon:"Catalyst", rarity:5 },
    { name:"Escoffier", element:"Cryo", weapon:"Polearm", rarity:5 },
    { name:"Eula", element:"Cryo", weapon:"Claymore", rarity:5 },
    { name:"Ganyu", element:"Cryo", weapon:"Bow", rarity:5 },
    { name:"Kamisato Ayaka", element:"Cryo", weapon:"Sword", rarity:5 },
    { name:"Lohen", element:"Cryo", weapon:"Polearm", rarity:5 },
    { name:"Qiqi", element:"Cryo", weapon:"Sword", rarity:5 },
    { name:"Sandrone", element:"Cryo", weapon:"Claymore", rarity:5 },
    { name:"Shenhe", element:"Cryo", weapon:"Polearm", rarity:5 },
    { name:"Skirk", element:"Cryo", weapon:"Sword", rarity:5 },
    { name:"Wriothesley", element:"Cryo", weapon:"Catalyst", rarity:5 },
    { name:"Charlotte", element:"Cryo", weapon:"Catalyst", rarity:4 },
    { name:"Chongyun", element:"Cryo", weapon:"Claymore", rarity:4 },
    { name:"Diona", element:"Cryo", weapon:"Bow", rarity:4 },
    { name:"Freminet", element:"Cryo", weapon:"Claymore", rarity:4 },
    { name:"Kaeya", element:"Cryo", weapon:"Sword", rarity:4 },
    { name:"Layla", element:"Cryo", weapon:"Sword", rarity:4 },
    { name:"Mika", element:"Cryo", weapon:"Polearm", rarity:4 },
    { name:"Rosaria", element:"Cryo", weapon:"Polearm", rarity:4 },
    // Geo
    { name:"Albedo", element:"Geo", weapon:"Sword", rarity:5 },
    { name:"Arataki Itto", element:"Geo", weapon:"Claymore", rarity:5 },
    { name:"Chiori", element:"Geo", weapon:"Sword", rarity:5 },
    { name:"Linnea", element:"Geo", weapon:"Bow", rarity:5 },
    { name:"Navia", element:"Geo", weapon:"Claymore", rarity:5 },
    { name:"Xilonen", element:"Geo", weapon:"Sword", rarity:5 },
    { name:"Zhongli", element:"Geo", weapon:"Polearm", rarity:5 },
    { name:"Zibai", element:"Geo", weapon:"Sword", rarity:5 },
    { name:"Gorou", element:"Geo", weapon:"Bow", rarity:4 },
    { name:"Illuga", element:"Geo", weapon:"Polearm", rarity:4 },
    { name:"Kachina", element:"Geo", weapon:"Polearm", rarity:4 },
    { name:"Ningguang", element:"Geo", weapon:"Catalyst", rarity:4 },
    { name:"Noelle", element:"Geo", weapon:"Claymore", rarity:4 },
    { name:"Yun Jin", element:"Geo", weapon:"Polearm", rarity:4 }
  ];

  DEFAULT_CHARACTER_DB.forEach(function(c){ c.id = "c_" + c.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"); c.constellations = 0; c.owned = false; });

  var STORAGE_CHARACTERS_KEY = "wishCounter.characters.v1";

  function loadCharacters(){
    try{
      var raw = localStorage.getItem(STORAGE_CHARACTERS_KEY);
      if(raw){
        var parsed = JSON.parse(raw);
        if(Array.isArray(parsed) && parsed.length) return parsed;
      }
    }catch(e){}
    return JSON.parse(JSON.stringify(DEFAULT_CHARACTER_DB));
  }
  function saveCharacters(){
    try{ localStorage.setItem(STORAGE_CHARACTERS_KEY, JSON.stringify(charactersList)); }catch(e){}
  }

  // The weapons list is fully user-editable (add/edit/delete), so what's
  // actually used at runtime is a persisted copy in localStorage, seeded
  // from DEFAULT_WEAPON_DB the very first time the page loads.
  function loadWeapons(){
    try{
      var raw = localStorage.getItem(STORAGE_WEAPONS_KEY);
      if(raw){
        var parsed = JSON.parse(raw);
        if(Array.isArray(parsed) && parsed.length) return parsed;
      }
    }catch(e){}
    return JSON.parse(JSON.stringify(DEFAULT_WEAPON_DB));
  }
  function saveWeapons(){
    try{ localStorage.setItem(STORAGE_WEAPONS_KEY, JSON.stringify(weaponsList)); }catch(e){}
  }

  // Timeline entries (banners + events/challenges) imported from HoYoLAB's
  // act_calendar endpoint. Stored as a flat array, de-duplicated by an id
  // derived from category+name+start-date so re-importing a fresh calendar
  // snapshot only adds what's new instead of ever wiping out history.
  var STORAGE_TIMELINE_KEY = "wishCounter.timeline.v1";
  function loadTimeline(){
    try{
      var raw = localStorage.getItem(STORAGE_TIMELINE_KEY);
      if(raw){
        var parsed = JSON.parse(raw);
        if(Array.isArray(parsed)) return parsed;
      }
    }catch(e){}
    return [];
  }
  function saveTimeline(){
    try{ localStorage.setItem(STORAGE_TIMELINE_KEY, JSON.stringify(timelineEntries)); }catch(e){}
  }

  /* Automatically populate character roster from wish history */
  function populateCharactersFromPulls(uid){
    if(!uid || !db.accounts[uid]) return;
    
    // Build a map from normalized character names to their metadata from DEFAULT_CHARACTER_DB
    var charMap = {};
    DEFAULT_CHARACTER_DB.forEach(function(c){
      charMap[normalizeName(c.name)] = c;
    });
    
    // Count pulls for each character
    var characterPulls = {};
    GACHA_TYPES.forEach(function(gt){
      (db.accounts[uid].pulls[gt] || []).forEach(function(pull){
        if(pull.item_type === "Character"){
          var nameNorm = normalizeName(pull.name);
          if(!characterPulls[nameNorm]) characterPulls[nameNorm] = { name: pull.name, count: 0 };
          characterPulls[nameNorm].count++;
        }
      });
    });
    
    // Update charactersList with pulled characters
    Object.keys(characterPulls).forEach(function(nameNorm){
      var pullInfo = characterPulls[nameNorm];
      var dbInfo = charMap[nameNorm];
      
      if(dbInfo){
        // Find existing character in charactersList or create new one
        var existing = charactersList.find(function(c){ return normalizeName(c.name) === nameNorm; });
        if(existing){
          // Only use the pull count as a fallback guess for characters that
          // aren't already marked owned. Once a character is owned — whether
          // from this same guess or from an accurate roster import — never
          // downgrade/overwrite its constellation from pull count alone, or
          // a roster import's real data gets clobbered again on next refresh.
          if(!existing.owned){
            existing.constellations = Math.min(pullInfo.count - 1, 6);
            existing.owned = true;
          }
        } else {
          // Add new character from database with pull count
          var newChar = {
            id: "c_" + pullInfo.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
            name: pullInfo.name,
            element: dbInfo.element,
            weapon: dbInfo.weapon,
            rarity: dbInfo.rarity,
            constellations: Math.min(pullInfo.count - 1, 6),
            owned: true
          };
          charactersList.push(newChar);
        }
      }
    });
    
    saveCharacters();
  }

  // One-time migration for character lists saved before the "owned" field
  // existed: infer ownership from wish-history evidence on whichever account
  // is active, so returning users don't lose their greyed-out/colored state.
  function migrateCharacterOwnership(uid){
    var pulledNames = {};
    if(uid && db.accounts[uid]){
      GACHA_TYPES.forEach(function(gt){
        (db.accounts[uid].pulls[gt] || []).forEach(function(p){
          if(p.item_type === "Character") pulledNames[normalizeName(p.name)] = true;
        });
      });
    }
    var changed = false;
    charactersList.forEach(function(c){
      if(typeof c.owned !== "boolean"){
        c.owned = !!pulledNames[normalizeName(c.name)];
        changed = true;
      }
    });
    if(changed) saveCharacters();
  }

  /* ---------------------------------------------------------------------
   * Icons (Phosphor "regular" weight, inlined as SVG so the page stays a
   * single self-contained file with no icon-font/CDN dependency), used
   * everywhere in place of emoji. Source: https://phosphoricons.com
   * (MIT licensed). Paths pulled from @phosphor-icons/core.
   * ------------------------------------------------------------------- */
  // Maps our short internal icon keys to raw Phosphor path data. icon()
  // emits a fully-realized inline <svg> right away, no hydration step,
  // no CDN, nothing to wait on.
  var PHOSPHOR_ICONS = {
    gem: '<path d="M229.5,113,166.06,89.94,143,26.5a16,16,0,0,0-30,0L89.94,89.94,26.5,113a16,16,0,0,0,0,30l63.44,23.07L113,229.5a16,16,0,0,0,30,0l23.07-63.44L229.5,143a16,16,0,0,0,0-30ZM157.08,152.3a8,8,0,0,0-4.78,4.78L128,223.9l-24.3-66.82a8,8,0,0,0-4.78-4.78L32.1,128l66.82-24.3a8,8,0,0,0,4.78-4.78L128,32.1l24.3,66.82a8,8,0,0,0,4.78,4.78L223.9,128Z"/>',
    clipboard: '<path d="M200,32H163.74a47.92,47.92,0,0,0-71.48,0H56A16,16,0,0,0,40,48V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm-72,0a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm72,184H56V48H82.75A47.93,47.93,0,0,0,80,64v8a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V64a47.93,47.93,0,0,0-2.75-16H200Z"/>',
    trash: '<path d="M216,48H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM192,208H64V64H192ZM80,24a8,8,0,0,1,8-8h80a8,8,0,0,1,0,16H88A8,8,0,0,1,80,24Z"/>',
    chevronUp: '<path d="M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z"/>',
    chevronDown: '<path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/>',
    chevronsUpDown: '<path d="M181.66,170.34a8,8,0,0,1,0,11.32l-48,48a8,8,0,0,1-11.32,0l-48-48a8,8,0,0,1,11.32-11.32L128,212.69l42.34-42.35A8,8,0,0,1,181.66,170.34Zm-96-84.68L128,43.31l42.34,42.35a8,8,0,0,0,11.32-11.32l-48-48a8,8,0,0,0-11.32,0l-48,48A8,8,0,0,0,85.66,85.66Z"/>',
    check: '<path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/>',
    arrowUp: '<path d="M205.66,117.66a8,8,0,0,1-11.32,0L136,59.31V216a8,8,0,0,1-16,0V59.31L61.66,117.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,205.66,117.66Z"/>',
    pencil: '<path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/>',
    star: '<path d="M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z"/>',
    sparkles: '<path d="M239.35,70.08a13.41,13.41,0,0,0-11.77-9.28l-36.94-2.92L176.43,24.22a13.51,13.51,0,0,0-24.86,0L137.36,57.88,100.42,60.8a13.39,13.39,0,0,0-7.66,23.58l28.06,23.68-8.56,35.39a13.32,13.32,0,0,0,5.1,13.91,13.51,13.51,0,0,0,15,.69L164,139l31.65,19.06a13.54,13.54,0,0,0,15-.69,13.34,13.34,0,0,0,5.09-13.91l-8.56-35.39,28.06-23.68A13.32,13.32,0,0,0,239.35,70.08ZM193.08,99a8,8,0,0,0-2.61,8l8.28,34.21L168.13,122.8a8,8,0,0,0-8.25,0l-30.62,18.43L137.54,107a8,8,0,0,0-2.62-8L108,76.26l35.52-2.81a8,8,0,0,0,6.74-4.87L164,35.91l13.79,32.67a8,8,0,0,0,6.74,4.87l35.53,2.81Zm-105,24.18L29.66,181.66a8,8,0,0,1-11.32-11.32l58.45-58.45a8,8,0,0,1,11.32,11.32Zm10.81,49.87a8,8,0,0,1,0,11.31L45.66,237.66a8,8,0,0,1-11.32-11.32l53.27-53.26A8,8,0,0,1,98.92,173.08Zm73-1a8,8,0,0,1,0,11.32l-54.28,54.28a8,8,0,0,1-11.32-11.32l54.29-54.28A8,8,0,0,1,171.94,172.06Z"/>',
    x: '<path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/>',
    plus: '<path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"/>',
    download: '<path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z"/>',
    funnel: '<path d="M230.6,49.53A15.81,15.81,0,0,0,216,40H40A16,16,0,0,0,28.19,66.76l.08.09L96,139.17V216a16,16,0,0,0,24.87,13.32l32-21.34A16,16,0,0,0,160,194.66V139.17l67.74-72.32.08-.09A15.8,15.8,0,0,0,230.6,49.53ZM40,56h0Zm106.18,74.58A8,8,0,0,0,144,136v58.66L112,216V136a8,8,0,0,0-2.16-5.47L40,56H216Z"/>',
    list: '<path d="M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z"/>',
    user: '<path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z"/>',
    sword: '<path d="M216,32H152a8,8,0,0,0-6.34,3.12l-64,83.21L72,108.69a16,16,0,0,0-22.64,0l-12.69,12.7a16,16,0,0,0,0,22.63l20,20-28,28a16,16,0,0,0,0,22.63l12.69,12.68a16,16,0,0,0,22.62,0l28-28,20,20a16,16,0,0,0,22.64,0l12.69-12.7a16,16,0,0,0,0-22.63l-9.64-9.64,83.21-64A8,8,0,0,0,224,104V40A8,8,0,0,0,216,32ZM52.69,216,40,203.32l28-28L80.68,188Zm70.61-8L48,132.71,60.7,120,136,195.31ZM208,100.06l-81.74,62.88L115.32,152l50.34-50.34a8,8,0,0,0-11.32-11.31L104,140.68,93.07,129.74,155.94,48H208Z"/>',
    calendar: '<path d="M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Z"/>',
    gear: '<path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8,8,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z"/>'
  };
  function icon(name, extraClass, extraAttrs){
    var path = PHOSPHOR_ICONS[name];
    if(!path) return "";
    return '<svg class="ph-icon' + (extraClass ? " " + extraClass : "") +
      '" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"' + (extraAttrs ? " " + extraAttrs : "") + '>' + path + '</svg>';
  }
  var ELEMENT_ICONS = {
    Pyro:{ color:"#ff3c32", text:"#ffffff", path:'<path d="M 12.195312 24 C 9.550781 21.480469 6.230469 20.144531 3.347656 18.039062 C 0.824219 16.152344 2.886719 12.816406 4.351562 10.902344 C 5.472656 9.550781 6.480469 8.105469 7.355469 6.578125 C 7.34375 9.324219 10.03125 10.269531 12.125 11.222656 C 8.175781 10.992188 4.8125 15.601562 7.960938 18.71875 C 4.753906 17.394531 3.335938 14.511719 5.734375 11.570312 C 4.5 12.035156 3.613281 13.132812 3.421875 14.4375 C 3.230469 15.746094 3.765625 17.050781 4.816406 17.847656 C 7.101562 19.390625 9.730469 20.390625 11.9375 22.066406 C 12.03125 22.132812 12.152344 22.144531 12.257812 22.101562 C 14.382812 20.570312 16.730469 19.398438 18.980469 18.074219 C 21.8125 16.554688 21.5 13.320312 18.714844 11.929688 C 21.210938 16.765625 16.636719 20.402344 12.027344 20.066406 C 7.015625 19.699219 6.75 14.625 10.957031 15.429688 C 10.046875 15.9375 9.570312 16.980469 9.785156 18 C 10.6875 20.5625 14.851562 19.667969 16.316406 18.054688 C 18.195312 16.292969 16.878906 12.855469 14.640625 11.882812 C 12.082031 10.683594 7.023438 9.265625 8.984375 5.476562 C 10.175781 3.617188 11.570312 2.375 11.789062 0 C 12.53125 0.996094 14.261719 2.945312 13.914062 4.203125 C 13.503906 5.4375 12.054688 5.886719 11.605469 7.136719 C 11.3125 7.679688 11.253906 8.320312 11.4375 8.90625 C 11.625 9.496094 12.042969 9.984375 12.59375 10.261719 C 10.851562 8.394531 12.75 6.132812 14.566406 5.152344 C 13.460938 7.636719 14.277344 10.554688 16.515625 12.105469 C 15.269531 9.363281 14.203125 9.292969 16.292969 6.261719 C 16.699219 8.171875 17.804688 9.863281 19.390625 11.003906 C 22.917969 14.101562 22.648438 17.398438 18.5 19.691406 C 16.214844 20.839844 14.09375 22.289062 12.191406 24 Z M 13.121094 18 C 19.621094 15.558594 11.484375 9.144531 9.070312 14.558594 C 11.496094 13.171875 14.824219 15.292969 13.121094 18 Z M 13.121094 18 "></path>' },
    Hydro:{ color:"#5680ff", text:"#ffffff", path:'<path d="M 5.011719 20.992188 L 5.445312 21.214844 C 7.488281 22.324219 9.785156 22.894531 12.113281 22.863281 C 15.457031 22.804688 18.199219 20.191406 18.414062 16.851562 C 18.632812 13.511719 16.257812 10.566406 12.949219 10.070312 C 11.976562 9.914062 10.984375 9.992188 10.050781 10.296875 C 9.242188 10.589844 8.34375 10.195312 8.015625 9.398438 C 7.6875 8.601562 8.042969 7.691406 8.820312 7.328125 C 9.625 6.96875 10.484375 6.753906 11.359375 6.699219 C 15.265625 6.414062 18.855469 8.863281 20.015625 12.605469 C 21.132812 16.507812 19.324219 20.65625 15.699219 22.488281 C 22.929688 19.84375 23.796875 9.101562 17.089844 5.316406 C 15.34375 4.1875 13.269531 3.6875 11.199219 3.894531 C 8.800781 4.074219 6.5625 5.164062 4.941406 6.9375 C 4.691406 7.226562 4.453125 7.523438 4.230469 7.835938 C 3.871094 8.339844 3.238281 8.566406 2.640625 8.414062 C 2.015625 8.34375 1.492188 7.917969 1.300781 7.320312 C 1.195312 6.921875 1.257812 6.5 1.472656 6.148438 C 2.070312 5.03125 2.859375 4.03125 3.808594 3.195312 C 5.675781 1.507812 8.019531 0.4375 10.519531 0.140625 C 15.230469 -0.460938 19.847656 1.804688 22.257812 5.898438 C 26.859375 12.925781 21.808594 23.019531 13.527344 23.847656 C 11.652344 24.105469 9.746094 23.902344 7.96875 23.261719 C 6.792969 22.792969 5.769531 22.007812 5.011719 20.992188 Z M 14.46875 20.789062 C 13.28125 21.667969 11.671875 21.714844 10.4375 20.898438 C 9.628906 20.445312 9.125 19.589844 9.125 18.660156 C 9.121094 17.734375 9.621094 16.875 10.425781 16.417969 C 10.851562 16.132812 11.386719 16.066406 11.871094 16.234375 C 12.355469 16.40625 12.730469 16.792969 12.882812 17.285156 C 14.203125 20.816406 17.402344 17.535156 15.324219 15.148438 C 14.460938 13.984375 13.046875 13.363281 11.605469 13.519531 C 9.996094 13.636719 8.59375 14.648438 7.976562 16.136719 C 7.359375 17.621094 7.632812 19.332031 8.683594 20.550781 C 9.734375 21.773438 11.386719 22.292969 12.949219 21.902344 C 14.050781 21.636719 14.996094 20.921875 15.554688 19.929688 C 15.195312 20.214844 14.851562 20.53125 14.46875 20.789062 Z M 3.789062 16.320312 C 3.160156 16.320312 2.652344 16.832031 2.652344 17.457031 C 2.652344 18.085938 3.160156 18.59375 3.789062 18.59375 C 4.417969 18.59375 4.925781 18.085938 4.925781 17.457031 C 4.925781 16.832031 4.417969 16.320312 3.789062 16.320312 Z M 1.644531 10.515625 C 0.738281 10.511719 0 11.246094 0 12.15625 C 0 13.0625 0.734375 13.796875 1.644531 13.796875 C 2.550781 13.796875 3.285156 13.0625 3.285156 12.152344 C 3.285156 11.25 2.550781 10.515625 1.644531 10.515625 Z M 1.644531 10.515625 "></path>' },
    Anemo:{ color:"#61dbbb", text:"#222222", path:'<path d="M 0.34375 8.410156 C 1.652344 10.464844 3.449219 12.652344 6.105469 12.582031 C 7.863281 12.464844 10.175781 12.964844 10.699219 14.914062 C 11.234375 16.394531 9.285156 18.308594 8.105469 16.835938 C 7.921875 16.519531 8.035156 16.324219 8.402344 16.28125 C 10.117188 16.316406 10.710938 14.359375 9.085938 13.683594 C 7.695312 13.515625 6.433594 14.589844 5.09375 14.898438 C 1.359375 15.976562 -0.898438 11.535156 0.34375 8.410156 Z M 17.335938 12.574219 C 15.523438 12.449219 13.136719 13.539062 13.261719 15.632812 C 13.253906 16.121094 13.457031 16.585938 13.816406 16.910156 C 14.179688 17.238281 14.667969 17.386719 15.148438 17.324219 C 15.691406 17.34375 16.390625 16.386719 15.652344 16.273438 C 12.875 16.273438 13.902344 12.671875 16.246094 13.871094 C 17.472656 14.578125 18.851562 14.980469 20.261719 15.050781 C 23.347656 14.746094 24.671875 11.105469 23.671875 8.433594 C 22.179688 10.667969 20.316406 12.886719 17.335938 12.574219 Z M 13.1875 11.25 C 14.527344 10.964844 15.816406 10.46875 17.003906 9.773438 C 18.839844 8.738281 19.882812 6.703125 19.644531 4.605469 C 19.410156 2.507812 17.941406 0.753906 15.917969 0.152344 C 17.851562 4.023438 16.695312 8.722656 13.1875 11.25 Z M 10.882812 11.226562 C 7.308594 8.742188 6.125 3.992188 8.117188 0.121094 C 6.261719 0.667969 4.859375 2.1875 4.457031 4.078125 C 4.054688 5.96875 4.722656 7.929688 6.191406 9.183594 C 7.589844 10.171875 9.160156 10.890625 10.820312 11.300781 Z M 20.042969 11.074219 C 18.082031 12.195312 15.59375 11.695312 13.78125 13.160156 C 12.90625 13.640625 12.371094 14.570312 12.394531 15.566406 C 12.421875 16.566406 13.003906 17.46875 13.902344 17.902344 C 14.304688 18.074219 14.695312 18.257812 15.085938 17.929688 C 15.464844 17.640625 15.769531 17.648438 16.316406 17.90625 C 14.425781 19.523438 12.949219 21.570312 12.011719 23.875 C 11.058594 21.574219 9.578125 19.535156 7.6875 17.914062 C 8.054688 17.636719 8.5625 17.636719 8.929688 17.914062 C 9.960938 18.507812 11.40625 17.230469 11.597656 16.199219 C 12.019531 14.179688 9.992188 12.589844 8.199219 12.207031 C 7.320312 12 6.421875 11.894531 5.542969 11.691406 C 1.484375 10.863281 0.875 6.753906 2.859375 3.609375 C 4.007812 12.007812 9.71875 9.703125 12 14.339844 C 14.265625 9.761719 20.019531 11.972656 21.164062 3.609375 C 22.554688 6.035156 22.972656 9.644531 20.042969 11.074219 Z M 12.976562 19.972656 L 12 19.320312 L 11.019531 19.980469 L 12.015625 21.648438 Z M 12 17.378906 C 11.6875 18.128906 11.0625 18.699219 10.285156 18.9375 C 10.894531 19.140625 11.5625 18.957031 11.984375 18.472656 C 12.714844 19.035156 13.347656 19.1875 13.777344 18.910156 C 12.980469 18.699219 12.324219 18.136719 12 17.378906 Z M 12 17.378906 "></path>' },
    Electro:{ color:"#b25dcd", text:"#ffffff", path:'<path d="M 7.765625 23.171875 C 9.53125 23.296875 11.304688 23.019531 12.953125 22.371094 C 12.546875 22.246094 12.164062 22.140625 11.792969 22.007812 C 11.421875 21.882812 11.054688 21.738281 10.691406 21.578125 C 8.925781 20.898438 7.53125 19.5 6.851562 17.734375 C 6.5 16.734375 6.425781 15.65625 6.632812 14.613281 C 6.835938 14.851562 7.015625 15.089844 7.21875 15.300781 C 7.652344 15.785156 8.316406 15.992188 8.949219 15.847656 C 10.109375 15.636719 10.996094 14.695312 11.140625 13.527344 C 11.328125 12.414062 11.050781 11.273438 10.375 10.367188 C 9.703125 9.460938 8.691406 8.867188 7.570312 8.726562 C 5.078125 8.441406 2.746094 10.003906 2.054688 12.414062 C 1.675781 13.628906 1.484375 14.890625 1.496094 16.164062 C 1.488281 16.691406 1.496094 17.222656 1.496094 17.707031 C 0.425781 15.746094 -0.0859375 13.53125 0.015625 11.300781 C 0.21875 7.871094 1.894531 4.695312 4.609375 2.59375 C 4.164062 3.402344 3.71875 4.164062 3.320312 4.949219 C 2.898438 5.753906 2.65625 6.644531 2.613281 7.554688 C 2.96875 7.222656 3.273438 6.9375 3.585938 6.65625 C 4.617188 5.675781 5.890625 4.988281 7.277344 4.667969 C 9.152344 4.269531 11.101562 4.769531 12.550781 6.019531 L 11.792969 6.175781 C 11.164062 6.292969 10.625 6.691406 10.332031 7.257812 C 10.035156 7.824219 10.019531 8.496094 10.28125 9.078125 C 10.726562 10.355469 11.878906 11.253906 13.230469 11.375 C 14.480469 11.519531 15.734375 11.125 16.675781 10.285156 C 17.617188 9.445312 18.15625 8.246094 18.152344 6.984375 C 18.171875 5.347656 17.484375 3.78125 16.269531 2.6875 C 15.164062 1.640625 13.886719 0.789062 12.492188 0.175781 C 12.402344 0.132812 12.3125 0.0859375 12.183594 0.0195312 C 18.074219 0.0390625 23.082031 4.335938 23.996094 10.160156 C 23.511719 9.390625 23.0625 8.617188 22.5625 7.882812 C 22.066406 7.136719 21.417969 6.5 20.660156 6.019531 C 20.796875 6.65625 20.957031 7.253906 21.050781 7.867188 C 21.472656 9.894531 20.976562 12.007812 19.691406 13.632812 C 18.996094 14.429688 18.101562 15.03125 17.101562 15.378906 C 17.078125 15.382812 17.046875 15.382812 17.019531 15.378906 C 17.128906 15.035156 17.25 14.707031 17.335938 14.371094 C 17.558594 13.542969 17.1875 12.667969 16.4375 12.253906 C 15.523438 11.65625 14.351562 11.625 13.410156 12.171875 C 11.53125 13.089844 10.660156 15.289062 11.410156 17.246094 C 11.996094 19.039062 13.601562 20.308594 15.484375 20.46875 C 16.945312 20.601562 18.410156 20.300781 19.703125 19.609375 C 20.5 19.242188 21.246094 18.753906 22.007812 18.308594 C 22.105469 18.253906 22.191406 18.1875 22.316406 18.105469 C 19.371094 23.140625 13.203125 25.289062 7.765625 23.171875 Z M 7.765625 23.171875 "></path>' },
    Dendro:{ color:"#a5c83b", text:"#222222", path:'<path d="M 12 1.730469 L 10.679688 3.820312 C 10.25 4.5 10.316406 5.382812 10.839844 5.992188 L 12 7.34375 L 13.160156 5.992188 C 13.683594 5.382812 13.75 4.5 13.320312 3.820312 Z M 1.878906 5.910156 L 2.242188 7.191406 C 2.433594 7.859375 3.082031 8.285156 3.769531 8.191406 L 4.773438 8.050781 L 4.652344 7.089844 C 4.570312 6.46875 4.054688 6 3.433594 5.972656 Z M 22.121094 5.910156 L 20.566406 5.972656 C 19.941406 6 19.425781 6.46875 19.347656 7.089844 L 19.226562 8.050781 L 20.230469 8.191406 C 20.917969 8.285156 21.566406 7.859375 21.757812 7.191406 Z M 8.453125 6.414062 C 6.515625 6.414062 3.421875 8.128906 3.421875 12.027344 C 3.421875 12.417969 3.453125 12.808594 3.515625 13.195312 L 2.9375 12.78125 C 2.613281 12.542969 2.175781 12.542969 1.851562 12.78125 L 1.050781 13.371094 L 1.816406 13.871094 C 2.15625 14.101562 2.613281 14.070312 2.921875 13.800781 L 3.527344 13.277344 C 4.058594 16.273438 6.449219 17.589844 7.808594 18.242188 C 9.34375 18.976562 12 20.492188 12 22.273438 C 12 20.492188 14.65625 18.976562 16.191406 18.242188 C 17.550781 17.589844 19.9375 16.277344 20.472656 13.285156 L 21.070312 13.804688 C 21.382812 14.078125 21.839844 14.105469 22.183594 13.875 L 22.945312 13.371094 L 22.140625 12.78125 C 21.816406 12.542969 21.378906 12.542969 21.054688 12.78125 L 20.484375 13.199219 L 20.425781 13.238281 L 20.484375 13.195312 C 20.546875 12.808594 20.578125 12.421875 20.578125 12.03125 C 20.578125 8.132812 17.484375 6.417969 15.546875 6.417969 C 14.085938 6.417969 13.027344 7.289062 12.597656 7.722656 C 12.464844 7.851562 12.445312 8.054688 12.546875 8.207031 L 12.855469 8.683594 C 12.890625 8.734375 12.945312 8.765625 13.003906 8.769531 C 13.0625 8.773438 13.121094 8.746094 13.160156 8.699219 C 13.5625 8.191406 14.777344 7.007812 16.894531 7.796875 C 18.472656 8.386719 19.464844 9.859375 19.464844 11.613281 C 19.464844 13.371094 18.382812 15.925781 15.539062 16.980469 C 12.695312 18.03125 12 19.734375 12 19.734375 C 12 19.734375 11.304688 18.03125 8.460938 16.980469 C 5.617188 15.925781 4.535156 13.371094 4.535156 11.613281 C 4.535156 9.859375 5.523438 8.386719 7.105469 7.792969 C 9.222656 7.003906 10.4375 8.1875 10.839844 8.695312 C 10.878906 8.742188 10.9375 8.769531 10.996094 8.765625 C 11.054688 8.765625 11.109375 8.730469 11.144531 8.683594 L 11.453125 8.203125 C 11.554688 8.050781 11.535156 7.847656 11.402344 7.71875 C 10.976562 7.289062 9.917969 6.414062 8.453125 6.414062 Z M 15.367188 9.179688 C 14.851562 9.242188 14.253906 9.519531 13.601562 10.195312 C 13.601562 10.195312 15.128906 9.6875 15.675781 10.957031 C 16.226562 12.230469 15.664062 13.644531 13.246094 15.769531 C 13.246094 15.769531 14.730469 15.078125 15.972656 14.023438 C 16.351562 13.71875 16.835938 13.746094 17.320312 13.808594 C 17.804688 13.871094 18.160156 14.238281 18.160156 14.238281 C 17.816406 13.535156 17.21875 13.324219 16.738281 13.285156 C 17.503906 12.421875 17.953125 11.40625 17.457031 10.355469 C 17.28125 9.96875 16.984375 9.648438 16.617188 9.4375 C 16.3125 9.265625 15.882812 9.117188 15.367188 9.179688 Z M 8.628906 9.183594 C 8.113281 9.121094 7.683594 9.269531 7.378906 9.441406 C 7.011719 9.652344 6.71875 9.972656 6.539062 10.359375 C 6.042969 11.410156 6.492188 12.425781 7.257812 13.289062 C 6.777344 13.328125 6.179688 13.535156 5.835938 14.238281 C 5.835938 14.238281 6.191406 13.875 6.675781 13.8125 C 7.160156 13.746094 7.644531 13.722656 8.023438 14.027344 C 9.269531 15.078125 10.753906 15.769531 10.753906 15.769531 C 8.335938 13.644531 7.773438 12.230469 8.324219 10.957031 C 8.871094 9.6875 10.394531 10.199219 10.394531 10.199219 C 9.742188 9.523438 9.144531 9.246094 8.628906 9.183594 Z M 8.628906 9.183594 "></path>' },
    Cryo:{ color:"#77a2e6", text:"#ffffff", path:'<path d="M 2.007812 6.246094 C 2.007812 6.246094 4.292969 9.765625 5.167969 11.667969 C 5.257812 11.328125 5.328125 10.984375 5.378906 10.636719 C 7.332031 10.394531 9.3125 10.695312 11.101562 11.503906 C 9.503906 10.355469 8.257812 8.785156 7.492188 6.972656 C 7.765625 6.753906 8.03125 6.519531 8.28125 6.273438 C 6.195312 6.464844 2.007812 6.246094 2.007812 6.246094 Z M 9.300781 10.457031 C 8.039062 9.925781 6.699219 9.605469 5.335938 9.511719 C 5.292969 8.984375 5.183594 8.464844 5.003906 7.96875 C 5.523438 7.875 6.027344 7.714844 6.507812 7.488281 C 7.265625 8.628906 8.210938 9.628906 9.300781 10.457031 Z M 2.007812 17.753906 C 2.007812 17.753906 4.292969 14.234375 5.167969 12.332031 C 5.257812 12.671875 5.328125 13.015625 5.378906 13.363281 C 7.332031 13.605469 9.3125 13.304688 11.101562 12.496094 C 9.503906 13.644531 8.257812 15.214844 7.492188 17.027344 C 7.765625 17.246094 8.03125 17.480469 8.28125 17.726562 C 6.195312 17.535156 2.007812 17.753906 2.007812 17.753906 Z M 9.300781 13.542969 C 8.039062 14.074219 6.699219 14.394531 5.335938 14.488281 C 5.292969 15.015625 5.183594 15.535156 5.003906 16.03125 C 5.523438 16.125 6.027344 16.285156 6.507812 16.511719 C 7.265625 15.371094 8.210938 14.371094 9.300781 13.542969 Z M 12 23.574219 C 12 23.574219 10.097656 19.839844 8.886719 18.128906 C 9.226562 18.222656 9.5625 18.332031 9.890625 18.460938 C 11.074219 16.890625 11.804688 15.027344 12 13.074219 C 12.195312 15.027344 12.925781 16.894531 14.109375 18.460938 C 14.4375 18.332031 14.765625 18.222656 15.101562 18.128906 C 13.898438 19.839844 12 23.574219 12 23.574219 Z M 12 15.152344 C 11.835938 16.511719 11.441406 17.835938 10.84375 19.066406 C 11.277344 19.367188 11.667969 19.722656 12.007812 20.128906 C 12.347656 19.722656 12.742188 19.367188 13.175781 19.066406 C 12.570312 17.835938 12.171875 16.511719 12 15.152344 Z M 21.992188 17.753906 C 21.992188 17.753906 19.707031 14.234375 18.832031 12.332031 C 18.742188 12.671875 18.671875 13.015625 18.621094 13.363281 C 16.671875 13.605469 14.691406 13.304688 12.898438 12.496094 C 14.496094 13.644531 15.746094 15.214844 16.511719 17.027344 C 16.234375 17.246094 15.972656 17.476562 15.722656 17.726562 C 17.808594 17.535156 21.992188 17.753906 21.992188 17.753906 Z M 14.699219 13.542969 C 15.960938 14.074219 17.300781 14.394531 18.664062 14.488281 C 18.707031 15.015625 18.816406 15.535156 18.996094 16.03125 C 18.476562 16.125 17.96875 16.285156 17.492188 16.511719 C 16.730469 15.375 15.789062 14.371094 14.699219 13.542969 Z M 21.992188 6.246094 C 21.992188 6.246094 19.707031 9.765625 18.832031 11.667969 C 18.742188 11.328125 18.671875 10.984375 18.621094 10.636719 C 16.671875 10.394531 14.691406 10.695312 12.898438 11.503906 C 14.496094 10.355469 15.746094 8.785156 16.511719 6.972656 C 16.234375 6.753906 15.972656 6.523438 15.722656 6.273438 C 17.808594 6.464844 21.992188 6.246094 21.992188 6.246094 Z M 14.699219 10.457031 C 15.960938 9.925781 17.300781 9.605469 18.664062 9.511719 C 18.707031 8.984375 18.816406 8.464844 18.996094 7.96875 C 18.476562 7.875 17.96875 7.714844 17.492188 7.488281 C 16.730469 8.625 15.789062 9.628906 14.699219 10.457031 Z M 12 0.425781 C 12 0.425781 10.097656 4.160156 8.886719 5.871094 C 9.226562 5.777344 9.5625 5.667969 9.890625 5.539062 C 11.074219 7.109375 11.804688 8.972656 12 10.925781 C 12.195312 8.972656 12.925781 7.105469 14.109375 5.539062 C 14.4375 5.667969 14.765625 5.777344 15.101562 5.871094 C 13.898438 4.160156 12 0.425781 12 0.425781 Z M 12 8.847656 C 11.835938 7.488281 11.441406 6.164062 10.84375 4.933594 C 11.277344 4.632812 11.667969 4.277344 12.007812 3.871094 C 12.347656 4.277344 12.742188 4.632812 13.175781 4.933594 C 12.570312 6.164062 12.171875 7.488281 12 8.847656 Z M 13.890625 13.738281 L 13.773438 15.089844 L 12.542969 14.515625 L 11.449219 14.515625 L 10.222656 15.089844 L 10.109375 13.738281 L 9.5625 12.785156 L 8.449219 12.007812 L 9.5625 11.230469 L 10.109375 10.28125 L 10.226562 8.929688 L 11.457031 9.503906 L 12.554688 9.503906 L 13.785156 8.929688 L 13.902344 10.28125 L 14.449219 11.226562 L 15.5625 12.003906 L 14.449219 12.78125 Z M 13.890625 13.738281 "></path>' },
    Geo:{ color:"#f8ba4e", text:"#222222", path:'<path d="M 12.203125 10.300781 C 11.347656 11.222656 10.570312 12.085938 9.769531 12.9375 C 9.621094 13.054688 9.578125 13.257812 9.664062 13.425781 C 10.183594 14.585938 10.984375 15.597656 11.988281 16.375 C 12.078125 16.414062 12.183594 16.40625 12.269531 16.359375 C 12.933594 15.917969 13.613281 15.5 14.242188 15.007812 C 15.566406 13.980469 16.796875 12.839844 17.914062 11.589844 C 18.222656 12.21875 18.566406 12.789062 18.800781 13.414062 C 19.144531 14.328125 19.410156 15.277344 19.71875 16.210938 C 19.773438 16.378906 19.734375 16.566406 19.613281 16.699219 C 18.730469 17.941406 17.710938 19.082031 16.582031 20.101562 C 15.140625 21.398438 13.644531 22.625 12.167969 23.875 C 12.109375 23.921875 12.046875 23.960938 11.984375 24 C 11.125 23.296875 10.234375 22.597656 9.378906 21.871094 C 7.644531 20.398438 6.015625 18.808594 4.496094 17.113281 C 3.132812 15.617188 1.929688 13.984375 0.90625 12.234375 C 0.808594 12.089844 0.808594 11.902344 0.90625 11.757812 C 1.5625 10.671875 2.335938 9.660156 3.214844 8.742188 C 5.21875 13.980469 8.222656 18.777344 12.054688 22.871094 C 14.332031 20.648438 16.078125 17.945312 17.164062 14.957031 L 17.101562 14.902344 L 12.074219 19.125 C 12.007812 19.070312 11.9375 19.023438 11.875 18.953125 C 10.117188 17.273438 8.636719 15.328125 7.484375 13.1875 C 7.410156 13.097656 7.378906 12.980469 7.394531 12.863281 C 7.410156 12.75 7.472656 12.644531 7.570312 12.578125 C 8.425781 11.820312 9.28125 11.050781 10.140625 10.304688 C 10.527344 9.972656 10.953125 9.679688 11.402344 9.335938 Z M 12.59375 14.664062 C 13.046875 14.320312 13.46875 14.027344 13.855469 13.695312 C 14.722656 12.949219 15.570312 12.179688 16.429688 11.421875 C 16.523438 11.355469 16.582031 11.25 16.597656 11.136719 C 16.617188 11.019531 16.585938 10.902344 16.515625 10.8125 C 15.363281 8.667969 13.882812 6.71875 12.125 5.035156 C 12.066406 4.976562 11.996094 4.929688 11.929688 4.863281 L 6.898438 9.097656 L 6.832031 9.042969 C 7.921875 6.054688 9.667969 3.351562 11.949219 1.128906 C 15.78125 5.222656 18.785156 10.019531 20.789062 15.257812 C 21.664062 14.339844 22.4375 13.328125 23.09375 12.242188 C 23.191406 12.101562 23.191406 11.910156 23.09375 11.765625 C 22.070312 10.015625 20.863281 8.378906 19.492188 6.886719 C 17.980469 5.191406 16.351562 3.601562 14.621094 2.128906 C 13.765625 1.402344 12.882812 0.703125 12.015625 0 C 11.929688 0.0546875 11.875 0.0859375 11.832031 0.121094 C 10.359375 1.375 8.859375 2.601562 7.421875 3.894531 C 6.289062 4.914062 5.273438 6.058594 4.386719 7.300781 C 4.269531 7.433594 4.226562 7.617188 4.28125 7.789062 C 4.589844 8.722656 4.855469 9.675781 5.199219 10.585938 C 5.433594 11.207031 5.777344 11.789062 6.085938 12.410156 C 7.203125 11.164062 8.433594 10.019531 9.757812 8.992188 C 10.386719 8.503906 11.066406 8.082031 11.730469 7.640625 C 11.816406 7.59375 11.921875 7.585938 12.011719 7.625 C 13.015625 8.402344 13.816406 9.414062 14.335938 10.574219 C 14.421875 10.742188 14.378906 10.945312 14.230469 11.0625 C 13.429688 11.921875 12.644531 12.777344 11.796875 13.699219 Z M 12.59375 14.664062 "></path>' }
  };
  function elementIcon(el){
    var m = ELEMENT_ICONS[el];
    if(!m) return "";
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + m.path + '</svg>';
  }
  function characterElementByName(name){
    var norm = normalizeName(name);
    var c = charactersList.find(function(x){ return normalizeName(x.name) === norm; });
    return c ? c.element : null;
  }
  function weaponTypeByName(name){
    var norm = normalizeName(name);
    var w = weaponsList.find(function(x){ return normalizeName(x.name) === norm; });
    return w ? w.type : null;
  }
  var WEAPON_ICON_URLS = {
    Sword: "https://frzyc.github.io/genshin-optimizer/assets/icon_sword-F6l_dkLa.png",
    Claymore: "https://frzyc.github.io/genshin-optimizer/assets/icon_claymore-BbAP7Dsa.png",
    Polearm: "https://frzyc.github.io/genshin-optimizer/assets/icon_polearm-CaKS6OSm.png",
    Bow: "https://frzyc.github.io/genshin-optimizer/assets/icon_bow-N-D1Ucg9.png",
    Catalyst: "https://frzyc.github.io/genshin-optimizer/assets/icon_catalyst-DGU6NfnQ.png"
  };
  // Weapon art comes from an external PNG, not an SVG glyph, so it can't take
  // "currentColor" the way our inline icons do. A CSS mask re-fills the PNG's
  // silhouette with any solid color we want (white for filter buttons, or
  // whatever color the character's name is using), with no shadow/filter FX.
  function weaponIconMask(weapon, colorCss, sizePx){
    var url = WEAPON_ICON_URLS[weapon];
    if(!url) return "";
    return '<span class="weapon-icon-mask" style="width:' + sizePx + 'px;height:' + sizePx + 'px;' +
      'background-color:' + colorCss + ';' +
      '-webkit-mask-image:url(\'' + url + '\');mask-image:url(\'' + url + '\');' +
      '-webkit-mask-size:contain;mask-size:contain;' +
      '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;' +
      '-webkit-mask-position:center;mask-position:center;" title="' + escapeHtml(weapon) + '"></span>';
  }

  // paimon.moe hosts a portrait per character at a predictable path: the
  // name lowercased with spaces turned into underscores (e.g. "Yumemizuki
  // Mizuki" -> yumemizuki_mizuki.png). Used as a background image on each
  // character tile; if a given name doesn't resolve to an actual image
  // (renamed/custom entries, apostrophes, etc.) the <img>'s onerror handler
  // removes it and the tile just falls back to its plain rarity-colored card.
  function characterImageUrl(name){
    var slug = name.trim().toLowerCase()
      .replace(/[''´`]/g, "")
      .replace(/\s+/g, "_");
    return "https://paimon.moe/images/characters/" + slug + ".png";
  }

  // Same idea for weapons: lowercase the name, strip everything that isn't a
  // letter/number/hyphen/space (apostrophes, etc.) — hyphens are kept as-is,
  // not converted — then turn spaces into underscores. "The Catch" ->
  // the_catch.png, "Primordial Jade Winged-Spear" -> primordial_jade_winged-spear.png,
  // matching paimon.moe's actual path.
  function weaponImageUrl(name){
    var slug = name.trim().toLowerCase()
      .replace(/[^a-z0-9\-\s]/g, "")
      .replace(/\s+/g, "_");
    return "https://paimon.moe/images/weapons/" + slug + ".png";
  }

  // ---------------------------------------------------------------------
  // Portrait image cache (IndexedDB)
  // ---------------------------------------------------------------------
  // Character/weapon portraits are hotlinked straight from paimon.moe, so
  // repeat loads are entirely at the mercy of *their* HTTP cache headers,
  // which we don't control. This keeps a local copy of every portrait blob
  // in IndexedDB so repeat visits load from disk instantly instead of
  // re-fetching. Degrades quietly to plain <img src> loading if IndexedDB
  // isn't available (private browsing, old browser, etc.) or if paimon.moe's
  // response can't be read as a CORS-safe blob (see resolvePortraitImage).
  var IMG_CACHE_DB_NAME = "wish-counter-image-cache";
  var IMG_CACHE_STORE = "portraits";
  var imgCacheDbPromise = null;
  var imgCacheMemory = {}; // url -> object URL, so one session never re-reads the same portrait twice

  function openImageCacheDb(){
    if(imgCacheDbPromise) return imgCacheDbPromise;
    imgCacheDbPromise = new Promise(function(resolve){
      if(!window.indexedDB){ resolve(null); return; }
      var req;
      try { req = indexedDB.open(IMG_CACHE_DB_NAME, 1); }
      catch(e){ resolve(null); return; }
      req.onupgradeneeded = function(){
        var db = req.result;
        if(!db.objectStoreNames.contains(IMG_CACHE_STORE)){ db.createObjectStore(IMG_CACHE_STORE); }
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ resolve(null); };
    });
    return imgCacheDbPromise;
  }

  function readCachedBlob(db, url){
    return new Promise(function(resolve){
      if(!db){ resolve(null); return; }
      var req;
      try { req = db.transaction(IMG_CACHE_STORE, "readonly").objectStore(IMG_CACHE_STORE).get(url); }
      catch(e){ resolve(null); return; }
      req.onsuccess = function(){ resolve(req.result || null); };
      req.onerror = function(){ resolve(null); };
    });
  }

  function writeCachedBlob(db, url, blob){
    if(!db) return;
    try { db.transaction(IMG_CACHE_STORE, "readwrite").objectStore(IMG_CACHE_STORE).put(blob, url); }
    catch(e){ /* best-effort - a failed write just means no caching for this one */ }
  }

  // Resolves one <img data-cache-src="..."> once it's actually about to be
  // visible: memory hit -> IndexedDB hit -> network fetch (which also
  // populates the cache for next time). Falls back to loading the plain
  // remote URL directly on any failure (offline, paimon.moe missing CORS
  // headers on its static assets, DB unavailable, etc.) so images still work
  // even when caching doesn't. On a hard failure (image genuinely doesn't
  // exist) removes the tile's portrait, matching the old onerror behavior.
  function resolvePortraitImage(img){
    var url = img.getAttribute("data-cache-src");
    if(!url) return;
    img.removeAttribute("data-cache-src");
    if(imgCacheMemory[url]){ img.src = imgCacheMemory[url]; return; }
    openImageCacheDb().then(function(db){
      return readCachedBlob(db, url).then(function(blob){
        if(blob) return blob;
        return fetch(url, { mode: "cors" }).then(function(res){
          if(!res.ok) throw new Error("portrait fetch failed");
          return res.blob();
        }).then(function(freshBlob){
          writeCachedBlob(db, url, freshBlob);
          return freshBlob;
        });
      });
    }).then(function(blob){
      var objectUrl = URL.createObjectURL(blob);
      imgCacheMemory[url] = objectUrl;
      img.src = objectUrl;
    }).catch(function(){
      // Caching path failed for some reason - just load it the old way.
      img.onerror = function(){ img.remove(); };
      img.src = url;
    });
  }

  // Only resolve (and therefore only fetch) a portrait once it's actually
  // about to scroll into view - same intent as the old loading="lazy", just
  // under our control since the fetch needs to go through the cache instead
  // of a plain <img src>.
  var portraitLazyObserver = (typeof IntersectionObserver !== "undefined")
    ? new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if(entry.isIntersecting){
            portraitLazyObserver.unobserve(entry.target);
            resolvePortraitImage(entry.target);
          }
        });
      }, { rootMargin: "200px" })
    : null;

  function observePortraitImages(root){
    var imgs = (root || document).querySelectorAll("img[data-cache-src]");
    for(var i = 0; i < imgs.length; i++){
      if(portraitLazyObserver){ portraitLazyObserver.observe(imgs[i]); }
      else { resolvePortraitImage(imgs[i]); } // no IntersectionObserver support - just load them all
    }
  }

  // Character/weapon grids get rebuilt via grid.innerHTML = ... in several
  // places (filters, search, sort); rather than hooking every call site,
  // watch the document for newly-inserted portraits and pick them up as
  // they appear, batched to one scan per animation frame.
  var portraitScanQueued = false;
  function queuePortraitScan(){
    if(portraitScanQueued) return;
    portraitScanQueued = true;
    requestAnimationFrame(function(){ portraitScanQueued = false; observePortraitImages(); });
  }
  if(typeof MutationObserver !== "undefined"){
    new MutationObserver(queuePortraitScan).observe(document.body, { childList: true, subtree: true });
  }

  /* ---------------------------------------------------------------------
   * State
   * ------------------------------------------------------------------- */
  var db = loadData();          // { activeUid, accounts:{ uid:{ pulls:{200:[],301:[],302:[],400:[]} } } }
  var settings = loadSettings(); // { standardCharacters, standardWeapons, proxies }
  var weaponsList = loadWeapons(); // user-editable weapons reference list
  var charactersList = loadCharacters(); // user-editable character list with constellations
  var timelineEntries = loadTimeline(); // banner & event history imported from HoYoLAB's act_calendar
  migrateLegacyPaimonKeys(db);  // one-time fixup for accounts split into "paimon-<uid>" vs "<uid>"

  // Older versions of the paimon.moe importer stored accounts as "paimon-<uid>",
  // while the direct API importer has always stored accounts as plain "<uid>".
  // That mismatch meant the same in-game account could show up as two separate
  // profiles. This merges any leftover "paimon-<uid>" profile into the plain
  // "<uid>" profile (deduping pulls by id), or just renames it if there's no
  // plain-uid profile to merge into yet.
  function migrateLegacyPaimonKeys(db){
    var changed = false;
    Object.keys(db.accounts).slice().forEach(function(key){
      var m = key.match(/^paimon-(.+)$/);
      if(!m) return;
      var plainUid = m[1];
      var legacy = db.accounts[key];
      changed = true;
      if(db.accounts[plainUid]){
        Object.keys(legacy.pulls).forEach(function(gt){
          var target = db.accounts[plainUid].pulls[gt] || (db.accounts[plainUid].pulls[gt] = []);
          var result = mergePullsByContent(target, legacy.pulls[gt] || []);
          result.merged.sort(sortByTimeThenId);
          db.accounts[plainUid].pulls[gt] = result.merged;
        });
      } else {
        db.accounts[plainUid] = legacy;
      }
      delete db.accounts[key];
      if(db.activeUid === key) db.activeUid = plainUid;
    });
    if(changed){
      try{ localStorage.setItem(STORAGE_DATA_KEY, JSON.stringify(db)); }catch(e){}
    }
  }

  /* ---------------------------------------------------------------------
   * Persistence helpers
   * ------------------------------------------------------------------- */
  function loadData(){
    try{
      var raw = localStorage.getItem(STORAGE_DATA_KEY);
      if(raw) return JSON.parse(raw);
    }catch(e){}
    return { activeUid:null, accounts:{} };
  }
  function saveData(){
    try{ localStorage.setItem(STORAGE_DATA_KEY, JSON.stringify(db)); }
    catch(e){ console.error("Failed to save data", e); }
  }
  function loadSettings(){
    try{
      var raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
      if(raw){
        var parsed = JSON.parse(raw);
        return {
          standardCharacters: parsed.standardCharacters || DEFAULT_STD_CHARACTERS.slice(),
          standardWeapons: parsed.standardWeapons || DEFAULT_STD_WEAPONS.slice(),
          proxies: parsed.proxies || DEFAULT_PROXIES.slice(),
          pityBuffer: (parsed.pityBuffer != null ? parsed.pityBuffer : 0)
        };
      }
    }catch(e){}
    return {
      standardCharacters: DEFAULT_STD_CHARACTERS.slice(),
      standardWeapons: DEFAULT_STD_WEAPONS.slice(),
      proxies: DEFAULT_PROXIES.slice(),
      pityBuffer: 0
    };
  }
  function saveSettings(){
    try{ localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings)); }
    catch(e){ console.error("Failed to save settings", e); }
  }

  function ensureAccount(uid){
    if(!db.accounts[uid]){
      db.accounts[uid] = { pulls:{ "200":[], "301":[], "302":[], "400":[] } };
    }
    return db.accounts[uid];
  }

  /* ---------------------------------------------------------------------
   * paimon.moe backup compatibility
   *
   * paimon.moe's local-storage export stores pulls per-banner as
   * { total, legendary, rare, pulls:[{type,code,id,time,pity,rate}] }
   * under keys like "wish-counter-character-event" (optionally prefixed
   * with "accountN-"). There's no explicit rank field, so rarity is
   * inferred: weapon pulls with no "rate" field are always 3-star;
   * anything else is 5-star if its id is in the known list below, or if
   * its pity value exceeds 10 (4-star pity always caps at 10, so a value
   * above that can only belong to a 5-star). Otherwise it's treated as
   * 4-star. This heuristic is very reliable for older pulls and may
   * occasionally mis-classify a brand-new 5★ that hasn't been added to
   * the known list yet and happened to land with low pity.
   * ------------------------------------------------------------------- */
  var KNOWN_5STAR_IDS = new Set([
    "diluc","jean","keqing","mona","qiqi","tighnari","dehya","klee","tartaglia",
    "zhongli","albedo","ganyu","xiao","hu_tao","eula","kaedehara_kazuha",
    "kamisato_ayaka","kamisato_ayato","yoimiya","raiden_shogun","sangonomiya_kokomi",
    "arataki_itto","shenhe","yelan","yae_miko","alhaitham","nahida","wanderer",
    "nilou","cyno","baizhu","neuvillette","furina","navia","chiori","xianyun",
    "arlecchino","clorinde","sigewinne","emilie","mavuika","citlali","chasca",
    "mualani","kinich","varesa","skirk","escoffier","columbina","ineffa","nefer",
    "flins","yumemizuki_mizuki","venti","lyney","wriothesley","aloy",
    "lauma","xilonen","zibai","linnea","durin","varka","sandrone","nicole","lohen",
    "aquila_favonia","skyward_blade","wolfs_gravestone","skyward_pride",
    "primordial_jade_winged_spear","skyward_spine","amos_bow","skyward_harp",
    "lost_prayer_to_the_sacred_winds","skyward_atlas","primordial_jade_cutter",
    "freedom_sworn","song_of_broken_pines","the_unforged","summit_shaper",
    "elegy_for_the_end","memory_of_dust","everlasting_moonglow","staff_of_homa",
    "vortex_vanquisher","redhorn_stonethresher","mistsplitter_reforged",
    "thundering_pulse","haran_geppaku_futsu","engulfing_lightning",
    "splendor_of_tranquil_waters","a_thousand_floating_dreams",
    "tulaytullahs_remembrance","light_of_foliar_incision",
    "crimson_moons_semblance","verdict","fang_of_the_mountain_king",
    "beacon_of_the_reed_sea","uraku_misugiri","absolution"
  ]);

  function titleCaseId(id){
    return String(id).split("_").map(function(w){
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }

  function classifyPaimonPull(p){
    if(KNOWN_5STAR_IDS.has(p.id)) return "5";
    if(typeof p.pity === "number" && p.pity > 10) return "5";
    if(p.type === "weapon" && p.rate === undefined) return "3";
    return "4";
  }

  // ---------------------------------------------------------------------
  // Cross-source pull reconciliation
  //
  // The direct API importer keys pulls by the real gacha-log id from
  // HoYoverse (a big numeric string). The paimon.moe importer has no access
  // to that id at all — paimon.moe's own export only stores the item's name
  // slug, time, and pity count — so it has to invent a synthetic id instead.
  // Those two id schemes are NOT comparable, so a plain "same id?" dedup check
  // will never recognize the same real-world pull twice, and merging by id
  // silently duplicates every pull (this is what caused pity to jump from 67
  // to 135 instead of landing on 68).
  //
  // Instead, pulls are reconciled by content: (time + normalized item name).
  // Timestamps alone aren't unique — a single 10-pull shares one timestamp
  // across up to 10 entries, sometimes with repeated items — so this uses a
  // multiset (counts per key) rather than a plain Set: if both sides already
  // agree there were, say, three "Black Tassel" pulls at 2023-03-01 14:47:47,
  // the merge keeps three, not six.
  // ---------------------------------------------------------------------
  function normalizeItemName(name){
    return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function pullContentKey(p){
    return p.time + "|" + normalizeItemName(p.name);
  }
  // Merges newItems into existingList in place-safe fashion (returns a new
  // array), only adding items whose (time, name) aren't already accounted
  // for in existingList. Returns { merged, addedCount }.
  function mergePullsByContent(existingList, newItems){
    var counts = {};
    existingList.forEach(function(p){
      var k = pullContentKey(p);
      counts[k] = (counts[k] || 0) + 1;
    });
    var merged = existingList.slice();
    var addedCount = 0;
    newItems.forEach(function(item){
      var k = pullContentKey(item);
      if(counts[k] > 0){
        counts[k]--; // this real-world pull is already represented — consume, don't add
        return;
      }
      merged.push(item);
      addedCount++;
    });
    return { merged: merged, addedCount: addedCount };
  }

  // Returns { uid: { pulls: {200:[],301:[],302:[],400:[]} }, ... } or {} if
  // nothing recognizable was found.
  function convertPaimonExport(parsed){
    var bannerGachaType = { "character-event":"301", "weapon-event":"302", "standard":"200", "chronicled":"301" };
    var accounts = {};
    Object.keys(parsed).forEach(function(key){
      var m = key.match(/^(.*?)wish-counter-(character-event|weapon-event|standard|chronicled)$/);
      if(!m) return;
      var prefix = m[1]; // "" or e.g. "account4-"
      var bannerName = m[2];
      var obj = parsed[key];
      if(!obj || !Array.isArray(obj.pulls)) return;
      var rawUid = parsed[prefix + "wish-uid"] || (prefix ? prefix.replace(/-$/, "") : "default");
      // NOTE: uid is intentionally NOT prefixed with "paimon-" here. The direct
      // API importer keys accounts by the raw numeric uid it reads from the
      // gacha log response (see uidForThisImport below), so this importer has
      // to key accounts the exact same way — otherwise the same account ends
      // up split across two separate profiles ("paimon-123..." vs "123...").
      var uid = String(rawUid);
      if(!accounts[uid]) accounts[uid] = { pulls:{ "200":[], "301":[], "302":[], "400":[] } };
      var gt = bannerGachaType[bannerName];
      obj.pulls.forEach(function(p, idx){
        var rank = classifyPaimonPull(p);
        accounts[uid].pulls[gt].push({
          id: "paimon-" + gt + "-" + p.time + "-" + idx + "-" + p.id,
          time: p.time,
          name: titleCaseId(p.id),
          item_type: p.type === "character" ? "Character" : "Weapon",
          rank_type: rank,
          gacha_type: gt
        });
      });
    });
    return accounts;
  }

  /* ---------------------------------------------------------------------
   * Networking: fetch a single gacha log page, trying proxies in order
   * ------------------------------------------------------------------- */
  function sleep(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }

  function fetchJsonWithFallback(targetUrl, log){
    var proxies = (settings.proxies && settings.proxies.length) ? settings.proxies : DEFAULT_PROXIES;
    var i = 0;
    function attempt(){
      if(i >= proxies.length){
        return Promise.reject(new Error("All connection methods failed (direct + relays). Check your internet connection."));
      }
      var prefix = proxies[i];
      var finalUrl = prefix ? (prefix + encodeURIComponent(targetUrl)) : targetUrl;
      i++;
      return fetch(finalUrl, { method:"GET", cache:"no-store" })
        .then(function(resp){
          if(!resp.ok) throw new Error("HTTP " + resp.status);
          return resp.text();
        })
        .then(function(text){
          var parsed;
          try{ parsed = JSON.parse(text); }
          catch(e){ throw new Error("Response wasn't valid JSON (relay may have altered it)"); }
          return parsed;
        })
        .catch(function(err){
          if(log) log("warn", (prefix ? "Relay " + (i) : "Direct request") + " failed: " + err.message + ", trying next method...");
          return attempt();
        });
    }
    return attempt();
  }

  /* ---------------------------------------------------------------------
   * Import flow
   * ------------------------------------------------------------------- */
  function buildPageUrl(baseUrl, gachaType, page, endId){
    var u;
    try{ u = new URL(baseUrl); }
    catch(e){ throw new Error("That doesn't look like a valid URL."); }
    var p = u.searchParams;
    p.set("gacha_type", gachaType);
    p.set("page", String(page));
    p.set("size", String(PAGE_SIZE));
    p.set("end_id", endId);
    if(!p.get("lang")) p.set("lang","en");
    return u.toString();
  }

  function fetchGachaType(baseUrl, gachaType, existingKeys, log, onNewItems){
    var page = 1, endId = "0", retries = 0, collected = [];
    function loop(){
      var url = buildPageUrl(baseUrl, gachaType, page, endId);
      return fetchJsonWithFallback(url, log).then(function(data){
        if(data.retcode !== 0){
          var msg = data.message || ("retcode " + data.retcode);
          if(/frequent|too fast|visit too/i.test(msg) && retries < MAX_RETRIES){
            retries++;
            log("warn", "Rate limited, waiting a moment… (attempt " + retries + ")");
            return sleep(RATE_LIMIT_WAIT_MS).then(loop);
          }
          throw new Error("Server said: " + msg + ". Your link may have expired, generate a fresh one.");
        }
        retries = 0;
        var list = (data.data && data.data.list) || [];
        if(list.length === 0){
          return collected;
        }
        var newOnes = [];
        var allKnown = true;
        // Content-based check (time+name), not raw id: pulls already present
        // from a paimon.moe import use a different, incompatible id scheme,
        // so an id-only check would never consider this page "already known"
        // and would re-fetch (and risk re-adding) the whole history every time.
        for(var k=0;k<list.length;k++){
          if(!existingKeys.has(pullContentKey(list[k]))){
            allKnown = false;
          }
          newOnes.push(list[k]);
        }
        collected = collected.concat(newOnes);
        if(onNewItems) onNewItems(newOnes);
        if(allKnown){
          // everything on this page was already stored -> older pages are too
          return collected;
        }
        endId = list[list.length-1].id;
        page++;
        return sleep(REQUEST_DELAY_MS).then(loop);
      });
    }
    return loop();
  }

  var BANNER_NAMES = { "200":"Standard", "301":"Character Event", "302":"Weapon Event", "400":"Character Event" };

  function runImport(rawUrl){
    var logEl = document.getElementById("importLog");
    logEl.className = "log-box show";
    logEl.innerHTML = "";
    function log(kind, msg){
      var line = document.createElement("div");
      line.className = kind;
      line.textContent = msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }

    var startBtn = document.getElementById("startImport");
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="spinner"></span>Fetching…';

    var url = rawUrl.trim();
    if(!url){
      log("err","Paste your wish history URL first.");
      startBtn.disabled = false; startBtn.textContent = "Fetch Wishes";
      return;
    }

    var uidForThisImport = null;
    var chain = Promise.resolve();
    var totalsNew = {};

    GACHA_TYPES.forEach(function(gt){
      chain = chain.then(function(){
        log("ok", "Fetching " + BANNER_NAMES[gt] + " (type " + gt + ")…");
        // existing keys for whichever account this ends up being — we don't know uid yet on the very
        // first call, so if this is the first gacha type, existingKeys starts empty and we detect
        // uid from the first returned item. Keyed by content (time+name), not raw id, since ids
        // from a paimon.moe import use a different, incompatible scheme.
        var existingKeys = new Set();
        if(uidForThisImport && db.accounts[uidForThisImport]){
          (db.accounts[uidForThisImport].pulls[gt] || []).forEach(function(it){ existingKeys.add(pullContentKey(it)); });
        }
        var newCount = 0;
        return fetchGachaType(url, gt, existingKeys, log, function(newOnes){
          newOnes.forEach(function(item){
            if(!uidForThisImport && item.uid){
              uidForThisImport = item.uid;
              ensureAccount(uidForThisImport);
              // now that we know the account, seed existingKeys with its current pulls
              (db.accounts[uidForThisImport].pulls[gt] || []).forEach(function(it){ existingKeys.add(pullContentKey(it)); });
            }
          });
        }).then(function(collected){
          if(!uidForThisImport){
            // no items at all across this whole gacha type and none previously discovered
            return;
          }
          var acct = ensureAccount(uidForThisImport);
          var store = acct.pulls[gt];
          var normalized = collected.map(function(item){
            return {
              id:item.id, time:item.time, name:item.name,
              item_type:item.item_type, rank_type:item.rank_type, gacha_type:gt
            };
          });
          var result = mergePullsByContent(store, normalized);
          acct.pulls[gt] = result.merged;
          newCount = result.addedCount;
          totalsNew[gt] = newCount;
          log(newCount>0 ? "ok":"warn", BANNER_NAMES[gt] + ": " + newCount + " new wish" + (newCount===1?"":"es") + " found.");
        });
      });
    });

    chain.then(function(){
      if(!uidForThisImport){
        log("err","No wishes were returned at all. Double-check the link was copied right after the command finished, and that the wish history screen was open in-game.");
        startBtn.disabled = false; startBtn.textContent = "Fetch Wishes";
        return;
      }
      db.activeUid = uidForThisImport;
      Object.keys(db.accounts[uidForThisImport].pulls).forEach(function(gt){
        db.accounts[uidForThisImport].pulls[gt].sort(sortByTimeThenId);
      });
      saveData();
      populateCharactersFromPulls(uidForThisImport);
      log("ok","Done. Data saved locally for account " + uidForThisImport + ".");
      startBtn.disabled = false; startBtn.textContent = "Fetch Wishes";
      renderAll();
    }).catch(function(err){
      log("err", err.message || String(err));
      startBtn.disabled = false; startBtn.textContent = "Fetch Wishes";
    });
  }

  function sortByTimeThenId(a,b){
    if(a.time < b.time) return -1;
    if(a.time > b.time) return 1;
    // ids are numeric strings of equal-ish magnitude; compare as BigInt if possible
    try{
      var ba = BigInt(a.id), bb = BigInt(b.id);
      if(ba<bb) return -1; if(ba>bb) return 1; return 0;
    }catch(e){
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    }
  }

  /* ---------------------------------------------------------------------
   * Stats computation
   * ------------------------------------------------------------------- */
  function combinedPulls(uid, bannerKey){
    var acct = db.accounts[uid];
    if(!acct) return [];
    var meta = BANNER_META[bannerKey];
    var all = [];
    meta.types.forEach(function(gt){
      all = all.concat(acct.pulls[gt] || []);
    });
    all.sort(sortByTimeThenId);
    return all;
  }

  // Normalizes a name for comparison against the Settings std-character/weapon
  // lists: lowercases, collapses whitespace, and strips every apostrophe-like
  // character entirely (straight ', curly '/', backtick, acute accent).
  // Apostrophes are stripped rather than unified because some import paths
  // (e.g. paimon.moe-style backups, which rebuild names from an internal id
  // like "amos_bow") produce names with NO apostrophe at all ("Amos Bow"),
  // not just a differently-encoded one. Stripping on both sides is the only
  // comparison that matches every case.
  function normalizeName(str){
    return String(str||"")
      .replace(/[\u2018\u2019\u02BC\u00B4`']/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // The full known-5★ name set, built from the live character/weapon
  // databases (which include any characters/weapons the user has added or
  // edited) rather than just the Standard-banner-only lists in Settings.
  // A 5★ can be misclassified as 4★/3★ on ANY banner (Character, Weapon, or
  // Standard) by an import source that doesn't recognize a newer release —
  // this isn't a Standard-banner-only problem, so the correction below
  // isn't either.
  function known5StarNameSet(){
    var set = new Set();
    charactersList.forEach(function(c){ if(c.rarity === 5) set.add(normalizeName(c.name)); });
    weaponsList.forEach(function(w){ if(w.rarity === 5) set.add(normalizeName(w.name)); });
    return set;
  }

  // Wish-history timestamps are plain local wall-clock strings with no
  // timezone marker ("2026-07-12 11:57:21"). Treat them as UTC+8 (Asia
  // server) — the same convention the Timeline's "local time" toggle
  // defaults to — which is precise enough to tell which banner run a pull
  // landed in.
  function pullTimeMs(timeStr){
    var iso = String(timeStr || "").replace(" ", "T") + "+08:00";
    var t = new Date(iso).getTime();
    return isNaN(t) ? null : t;
  }

  // Looks up whether a specific pulled 4★ was an actual rate-up on the
  // banner it was pulled from, using the real per-banner rosters imported
  // from HoYoLAB's act_calendar (the same data the Timeline chart is built
  // from) — rather than guessing from a generic "standard 4★" list. A 12h
  // buffer absorbs any minor timezone slop around a banner's exact reset
  // time. Returns true/false when a matching imported banner is found for
  // that date, or null if there's no timeline data covering it (so the
  // caller can fall back to the generic heuristic instead).
  function lookupRateUp4(bannerKey, timeStr, itemType, itemName){
    var category = bannerKey === "character" ? "character-banner" : bannerKey === "weapon" ? "weapon-banner" : null;
    if(!category) return null;
    var t = pullTimeMs(timeStr);
    if(t === null) return null;

    var BUFFER_MS = 12*3600000;
    var matches = timelineEntries.filter(function(e){
      return e.category === category && t >= (e.start - BUFFER_MS) && t <= (e.end + BUFFER_MS);
    });
    if(!matches.length) return null;

    var normalized = normalizeName(itemName);
    var listKey = itemType === "Character" ? "fourStarChars" : "fourStarWeapons";
    return matches.some(function(e){
      return (e[listKey] || []).some(function(n){ return normalizeName(n) === normalized; });
    });
  }

  function computeBannerStats(uid, bannerKey){
    var meta = BANNER_META[bannerKey];
    var pulls = combinedPulls(uid, bannerKey);
    var stdChars = new Set((settings.standardCharacters||[]).map(normalizeName));
    var stdWeps  = new Set((settings.standardWeapons||[]).map(normalizeName));
    // Standard 4★ weapons aren't a short fixed roster like 5★s — once a
    // weapon-banner 4★ finishes its own rate-up run it folds into the
    // general filler pool, which is effectively "whatever 4★ weapons you
    // already track." So the user's own Weapons list doubles as that pool.
    var stdFourWeps = new Set(weaponsList.filter(function(w){ return w.rarity === 4; }).map(function(w){ return normalizeName(w.name); }));

    // Self-correct any pull whose name matches a KNOWN 5★ character/weapon
    // but whose source data (HoYoverse API history or a paimon.moe-style
    // backup) mislabeled it as 3★/4★. This runs for every banner, not just
    // Standard — a limited-banner 5★ (e.g. a newly-released character) can
    // be misclassified exactly the same way if the import source doesn't
    // recognize it yet.
    var known5 = known5StarNameSet();
    pulls = pulls.map(function(p){
      if(p.rank_type === "5") return p;
      if(!known5.has(normalizeName(p.name))) return p;
      var fixed = {};
      for(var k in p){ fixed[k] = p[k]; }
      fixed.rank_type = "5";
      return fixed;
    });

    var pity5 = 0, pity4 = 0;
    var fiveStars = [], fourStars = [], threeStars = [];
    var count5=0, count4=0, count3=0;
    var sum5pity=0, sum4pity=0;
    var win5=0, lose5=0;
    var char4=0, wep4=0;
    var char5=0, wep5=0;

    for(var i=0;i<pulls.length;i++){
      var p = pulls[i];
      pity5++; pity4++;
      if(p.rank_type === "5"){
        count5++;
        sum5pity += pity5;
        if(p.item_type==="Character") char5++; else wep5++;
        var isStd = meta.kind==="limited" ? (
          p.item_type==="Character" ? stdChars.has(normalizeName(p.name)) : stdWeps.has(normalizeName(p.name))
        ) : null;
        var guaranteed = meta.kind==="limited" && fiveStars.length>0 && fiveStars[fiveStars.length-1].isStd===true;
        fiveStars.push({ name:p.name, pity:pity5, time:p.time, item_type:p.item_type, isStd:isStd, guaranteed:guaranteed });
        if(meta.kind==="limited"){
          // Guaranteed pulls (the "G" ones) aren't a real coin-flip outcome —
          // the featured item was locked in ahead of time — so they're left
          // out of the win/loss tally to keep the win rate a true 50/50 (or
          // 75/25 for weapons) read on actual chance-based outcomes.
          if(!guaranteed){
            if(isStd) lose5++; else win5++;
          }
        }
        pity5 = 0; pity4 = 0;
      } else if(p.rank_type === "4"){
        count4++;
        sum4pity += pity4;
        if(p.item_type==="Character") char4++; else wep4++;
        // Same idea as the 5★ guarantee: a 4★ pull only "loses" the rate-up
        // if it could plausibly have been a rate-up slot at all. On Character
        // Event Wish the 3 rate-ups are always characters, so any 4★ WEAPON
        // there is automatically off-banner — no character-name lookup
        // needed. Same logic mirrored for the Weapon Event Wish.
        //
        // When the item type DOES match a rate-up slot, check the real
        // per-banner rosters imported from HoYoLAB's act_calendar (same data
        // the Timeline chart uses) — that's actual per-patch truth rather
        // than a guess. If there's no imported timeline data covering that
        // pull's date: for a 4★ weapon, fall back to the Weapons list
        // heuristic; for a 4★ character, there's no reliable fallback left,
        // so it's simply left unknown (like 3★ pulls) rather than guessed.
        var isStd4;
        if(meta.kind!=="limited"){
          isStd4 = null;
        } else if(p.item_type==="Character" && bannerKey==="weapon"){
          isStd4 = true;
        } else if(p.item_type==="Weapon" && bannerKey==="character"){
          isStd4 = true;
        } else {
          var realRateUp = lookupRateUp4(bannerKey, p.time, p.item_type, p.name);
          if(realRateUp !== null){
            isStd4 = !realRateUp;
          } else if(p.item_type==="Weapon"){
            isStd4 = stdFourWeps.has(normalizeName(p.name));
          } else {
            isStd4 = null;
          }
        }
        var guaranteed4 = meta.kind==="limited" && fourStars.length>0 && fourStars[fourStars.length-1].isStd4===true;
        fourStars.push({ name:p.name, pity:pity4, time:p.time, item_type:p.item_type, isStd4:isStd4, guaranteed4:guaranteed4 });
        pity4 = 0;
      } else {
        count3++;
        threeStars.push({ name:p.name, pity:1, time:p.time, item_type:p.item_type });
      }
    }

    var total = pulls.length;
    return {
      key:bannerKey, label:meta.label, pity5Cap:meta.pity5, pity4Cap:meta.pity4, kind:meta.kind,
      total:total,
      currentPity5:pity5, currentPity4:pity4,
      guaranteedNext: meta.kind==="limited" && fiveStars.length>0 && fiveStars[fiveStars.length-1].isStd===true,
      guaranteedNext4: meta.kind==="limited" && fourStars.length>0 && fourStars[fourStars.length-1].isStd4===true,
      count5:count5, count4:count4, count3:count3,
      pct5: total? (count5/total*100):0, pct4: total? (count4/total*100):0,
      avgPity5: count5? (sum5pity/count5):0, avgPity4: count4? (sum4pity/count4):0,
      char4:char4, wep4:wep4,
      char5:char5, wep5:wep5,
      win5:win5, lose5:lose5, winPct5: (win5+lose5)? (win5/(win5+lose5)*100):0,
      fiveStars: fiveStars.slice().reverse(), // most recent first
      fourStars: fourStars.slice().reverse(),
      threeStars: threeStars.slice().reverse(),
      pulls: pulls
    };
  }

  /* ---------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------- */
  var openDetails = {}; // bannerKey -> bool, persists across re-renders within a session
  var rarityFilters = {}; // bannerKey -> {5:bool, 4:bool, 3:bool}, 3-star off by default
  var sortAsc = {}; // bannerKey -> bool, false = newest first (default)

  var activeView = "wish"; // "wish" | "characters" | "weapons"
  // Characters/Weapons re-render on every tab switch by default, which
  // tears down and rebuilds every <img> in the grid — even when nothing
  // changed, forcing them to redecode (and often refetch) each visit.
  // These flags mean "this view's DOM is stale and needs a rebuild";
  // mutations set the flag (or re-render immediately if already on that
  // tab), and switching tabs only rebuilds when actually needed.
  var charactersViewDirty = true;
  var weaponsViewDirty = true;
  function refreshCharactersView(){
    if(activeView === "characters"){ renderCharactersView(); charactersViewDirty = false; }
    else { charactersViewDirty = true; }
  }
  function refreshWeaponsView(){
    if(activeView === "weapons"){ renderWeaponsView(); weaponsViewDirty = false; }
    else { weaponsViewDirty = true; }
  }
  var weaponsSort = "type";
  var weaponsSortAscMap = { name:true, type:true, rarity:false, atk:false, secondary:true, pulls:false };
  var weaponsTypeFilter = { Sword:true, Claymore:true, Polearm:true, Bow:true, Catalyst:true };
  var weaponsRarityFilter = { 5:true, 4:true, 3:true, 2:true, 1:true };
  var weaponsSearchTerm = "";
  
  // Characters view state
  var charactersSort = "element";
  var charactersSearchTerm = "";
  var charactersElementFilter = { Pyro:true, Hydro:true, Anemo:true, Electro:true, Dendro:true, Cryo:true, Geo:true };
  var charactersWeaponFilter = { Sword:true, Claymore:true, Polearm:true, Bow:true, Catalyst:true };
  var charactersRarityFilter = { 5:true, 4:true };

  function fmt(n){ return n.toLocaleString(); }
  function fmt1(n){ return (Math.round(n*10)/10).toFixed(1); }

  function renderAll(){
    var uid = db.activeUid;
    renderAccountSelector();
    document.getElementById("uidLabel").textContent = uid ? ("UID " + uid) : "no account loaded, import to begin";
    document.getElementById("uidLabelTop").textContent = uid ? ("UID " + uid) : "no account loaded";
    document.getElementById("uidLabelSidebar").textContent = uid ? ("UID " + uid) : "no account loaded";

    var grid = document.getElementById("cardsGrid");
    grid.innerHTML = "";

    if(!uid || !db.accounts[uid]){
      document.getElementById("worthStrip").style.display = "none";
      document.getElementById("historyWrap").style.display = "none";
      document.getElementById("openImport").style.display = "none";
      var empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML =
        '<div class="empty-icon">' + icon("sparkles") + '</div>' +
        '<h2>Nothing imported yet</h2>' +
        '<p class="empty-note">Paste the URL from the PowerShell script to load your wish history.</p>';
      var emptyImportBtn = document.createElement("button");
      emptyImportBtn.className = "btn-primary";
      emptyImportBtn.id = "openImportEmpty";
      emptyImportBtn.innerHTML = icon("download") + " Import Wishes";
      emptyImportBtn.addEventListener("click", openImportOverlay);
      empty.appendChild(emptyImportBtn);
      grid.appendChild(empty);
      if(activeView === "weapons") refreshWeaponsView();
      return;
    }
    document.getElementById("openImport").style.display = "";

    var order = ["character","weapon","standard"];
    var allStats = {};
    var totalPulls = 0;
    order.forEach(function(key){
      var s = computeBannerStats(uid, key);
      allStats[key] = s;
      totalPulls += s.total;
      grid.appendChild(renderCard(s));
      animateStatNumber("stat-" + key + "-total", s.total);
      animateStatNumber("stat-" + key + "-p5", s.currentPity5);
      animateStatNumber("stat-" + key + "-p4", s.currentPity4);
      animatePityBar("bar-" + key + "-p5", pityPct(s));
    });

    var worthStrip = document.getElementById("worthStrip");
    worthStrip.style.display = totalPulls>0 ? "flex" : "none";
    document.getElementById("worthValue").textContent = fmt(totalPulls*PRIMOGEMS_PER_WISH);
    document.getElementById("worthCount").textContent = fmt(totalPulls);

    renderHistoryChart(allStats);

    if(activeView === "weapons") refreshWeaponsView();
    if(activeView === "characters") refreshCharactersView();
  }

  function renderAccountSelector(){
    var sel = document.getElementById("accountSelect");
    var uids = Object.keys(db.accounts);
    if(uids.length <= 1){
      sel.style.display = "none";
      return;
    }
    sel.style.display = "inline-block";
    sel.innerHTML = "";
    uids.forEach(function(uid){
      var opt = document.createElement("option");
      opt.value = uid; opt.textContent = "UID " + uid;
      if(uid === db.activeUid) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function accountPullCount(uid){
    var acc = db.accounts[uid];
    if(!acc) return 0;
    return Object.keys(acc.pulls).reduce(function(sum, gt){ return sum + acc.pulls[gt].length; }, 0);
  }

  function renderAccountList(){
    var wrap = document.getElementById("accountList");
    var uids = Object.keys(db.accounts);
    if(uids.length === 0){
      wrap.innerHTML = '<div class="empty-note" style="padding:2px 0;">No accounts stored yet. Import wishes to add one.</div>';
      return;
    }
    wrap.innerHTML = uids.map(function(uid){
      var isActive = uid === db.activeUid;
      return '<div class="account-row' + (isActive ? " active" : "") + '">' +
        '<span class="account-row-info">' +
          '<span class="uid">UID ' + escapeHtml(uid) + '</span>' +
          (isActive ? '<span class="tag-active">active</span>' : '') +
          '<span class="count">' + fmt(accountPullCount(uid)) + ' pulls</span>' +
        '</span>' +
        '<button class="btn-danger btn-small account-delete" data-uid="' + escapeHtml(uid) + '" title="Delete this account\'s data">' + icon("trash") + ' Delete</button>' +
      '</div>';
    }).join("");

    wrap.querySelectorAll(".account-delete").forEach(function(btn){
      btn.addEventListener("click", function(){
        var uid = btn.getAttribute("data-uid");
        if(!confirm("Delete all stored wish data for UID " + uid + "? This can't be undone.")) return;
        delete db.accounts[uid];
        if(db.activeUid === uid){
          var remaining = Object.keys(db.accounts);
          db.activeUid = remaining.length ? remaining[0] : null;
        }
        saveData();
        renderAccountList();
        renderAll();
      });
    });
  }

  /* ---------------------------------------------------------------------
   * Header / nav modal
   * ------------------------------------------------------------------- */
  function setActiveView(view){
    activeView = view;
    document.querySelectorAll(".nav-item").forEach(function(btn){
      btn.classList.toggle("active", btn.getAttribute("data-view") === view);
    });
    document.querySelectorAll(".view-panel").forEach(function(panel){
      panel.classList.toggle("active", panel.id === "view-" + view);
    });
    if(view === "weapons") refreshWeaponsView();
    if(view === "characters") refreshCharactersView();
    if(view === "timeline") renderTimelineView();
    if(view === "settings") renderSettingsView();
    if(view === "wish"){
      // The wish-counter cards aren't rebuilt on tab switch (renderAll()
      // only runs on load/import/data changes) — they just get shown again
      // via the .view-panel.active CSS toggle above. animatePityBar() only
      // animates when the % actually differs from last time, so without
      // this, returning to a tab where nothing changed would leave the bar
      // sitting at its already-set width with nothing to play. Forcing the
      // tracked value back to 0 first makes it replay the same grow-in
      // every visit, using the exact same function/easing as a real update.
      ["character","weapon","standard"].forEach(function(key){
        var elId = "bar-" + key + "-p5";
        var target = lastPityBarPct[elId];
        if(target === undefined) return; // nothing rendered yet (no data imported)
        lastPityBarPct[elId] = 0;
        animatePityBar(elId, target);
      });
    }
  }
  document.querySelectorAll(".nav-item[data-view]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var view = btn.getAttribute("data-view");
      if(view !== activeView) setActiveView(view);
      closeModal("navOverlay");
    });
  });
  // 760px matches the breakpoint used throughout this file for the
  // narrow/mobile layout cutoff (single-column grid, filter-bar toggle,
  // etc.) - reused here so the sidebar/dropdown split lines up with every
  // other responsive decision already in the app.
  var SIDEBAR_BREAKPOINT = 760;
  var SIDEBAR_WIDTH = 220;
  function isWideLayout(){ return window.innerWidth > SIDEBAR_BREAKPOINT; }
  // Opening/closing the sidebar changes .app-body's margin-left, which is a
  // layout property - animating it directly forces the browser to redo
  // layout (recompute the character/weapon grids' column count) on every
  // single frame of the transition, which is what caused the stutter.
  // Instead: snap margin-left instantly (one reflow, via the CSS class),
  // while simultaneously applying an inverted inline transform so nothing
  // visually jumps, then transition that transform back to 0 next frame -
  // same visual slide, but done as a cheap GPU-composited animation with
  // the expensive part reduced to a single reflow instead of ~12 of them.
  // Morphs the hamburger icon's actual path shape into a caret-left (and
  // back), while rotating the icon 180deg, whenever the sidebar opens/closes.
  // MorphSVGPlugin is its own separate CDN script (see <head>) that can fail
  // to load independently of core GSAP/ScrollTrigger, so this checks for it
  // on its own rather than assuming gsapReady() covers it.
  var HAMBURGER_PATH_D = "M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z";
  var CARET_LEFT_PATH_D = "M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z";
  var morphPluginRegistered = false;
  function morphReady(){
    if(!gsapReady()) return false;
    if(typeof MorphSVGPlugin === "undefined") return false;
    if(!morphPluginRegistered){
      gsap.registerPlugin(MorphSVGPlugin);
      morphPluginRegistered = true;
    }
    return true;
  }
  // Flip is its own separate CDN script (see <head>) that can fail to load
  // independently of core GSAP/ScrollTrigger, so — same reasoning as
  // morphReady() above — this checks for it on its own rather than
  // assuming gsapReady() covers it.
  var flipPluginRegistered = false;
  function flipReady(){
    if(!gsapReady()) return false;
    if(typeof Flip === "undefined") return false;
    if(!flipPluginRegistered){
      gsap.registerPlugin(Flip);
      flipPluginRegistered = true;
    }
    return true;
  }
  // Shared by the Characters and Weapons grids: rebuilds a filtered/sorted
  // grid's contents via rebuildFn() (which does the actual
  // `grid.innerHTML = ...` swap) and, when Flip is available, animates the
  // surviving cards (matched by data-flip-id, since every card is a brand
  // new element each rebuild) from their old position to their new one,
  // fading added/removed ones in/out.
  //
  // Fix #1 (this pass): the grid containers are `display:grid`, and Flip's
  // `absolute:true` sets `position:absolute` on every animating element for
  // the duration of the tween so a card can glide over its neighbors. But
  // absolutely-positioned children don't contribute to a CSS Grid
  // container's height at all — with every card flipped to absolute at
  // once, the grid has nothing left sizing it and collapses to ~0 height
  // until Flip clears the inline styles, then snaps back. Locking the
  // grid's own height to its pre-rebuild measurement for the animation's
  // duration (cleared again in onComplete) fixes that collapse.
  //
  // Deliberately NOT yet handled here (next passes): this runs
  // unconditionally regardless of how many cards are being animated, so
  // very large filtered/sorted sets (100+ cards) may still show jank from
  // sheer element count.
  //
  // (Group headers now carry their own data-flip-id — see the "hdr-"
  // prefixed ids in renderCharactersView/renderWeaponsView — so they're
  // matched, animated, and faded in/out by Flip like any other tile.)
  function flipGridRebuild(grid, rebuildFn, opts){
    if(!flipReady()){
      rebuildFn();
      return;
    }
    opts = opts || {};

    // Same margin as the portrait lazy-loader, for consistency.
    var VIEWPORT_MARGIN = 200;
    function isNearViewport(rect){
      return rect.bottom > -VIEWPORT_MARGIN && rect.top < window.innerHeight + VIEWPORT_MARGIN;
    }
    // Snapshot which cards are near-viewport in their OLD spot, before
    // anything changes, keyed by data-flip-id — used below to decide
    // whether a card is worth actually animating (a card that was on
    // -screen and is about to move off-screen still needs its motion
    // seen, even though its destination isn't visible).
    var oldNearMap = {};
    grid.querySelectorAll("[data-flip-id]").forEach(function(el){
      oldNearMap[el.getAttribute("data-flip-id")] = isNearViewport(el.getBoundingClientRect());
    });

    var flipState = Flip.getState(grid.querySelectorAll("[data-flip-id]"));

    // Opt-in: also animate the wrapping .card's own height (e.g.
    // .characters-card) as it resizes to fit the new grid, instead of it
    // snapping to its new final size the instant the grid is locked below.
    // Measured before rebuildFn() runs, i.e. the card's OLD height — same
    // "measure before/after, animate between" approach as everything else
    // here, just applied one level up.
    var card = opts.animateCardHeight ? grid.closest(".card") : null;
    var cardOldHeight = card ? card.offsetHeight : null;

    rebuildFn();
    // Measure the TRUE final size now, with the new content laid out
    // normally (Flip hasn't touched anything yet), and apply it
    // immediately — before Flip starts, not eased alongside it. That way
    // the container is already at its final size for the entire
    // animation: nothing about it changes while Flip runs, and clearing
    // the inline size back to auto afterwards is a genuine no-op.
    //
    // (Previously this also pinned the wrapping .card, e.g.
    // .characters-card, on the theory that the grid collapsing internally
    // would shrink its parent too. Confirmed via testing that pinning the
    // grid's own height alone is enough — .card's height is just the sum
    // of its own in-flow children, and the grid no longer changes size at
    // all, so .card was never actually at risk of resizing. That's still
    // true — .card's height is only touched now, below, when a caller
    // explicitly opts in to animating it for its own sake.)
    grid.style.height = grid.offsetHeight + "px";

    var flipDuration = 0.5;
    var flipStagger = 0.015;
    // The set of elements Flip will animate this run — queried once and
    // reused below for both the transition-suppress pass and Flip's own
    // targets, rather than re-querying the same settled DOM three times.
    var flipTargets = grid.querySelectorAll("[data-flip-id]");

    // Viewport culling, take two: every card still goes through Flip
    // uniformly (absolute:true for all of them) — a card that's near the
    // viewport in EITHER its old or new spot gets a real tween; anything
    // that was off-screen before AND stays off-screen after just gets
    // duration 0 (an instant snap nobody can see happen). Earlier this
    // excluded off-screen cards from Flip entirely instead, which broke
    // CSS Grid: an included card is pulled out of grid flow via
    // position:absolute and stops contributing to its row's size, so any
    // EXCLUDED (still in-flow) card left behind in that row had nothing
    // consistent left to size the row against, and stretched to fill a
    // track height that no longer matched its own content
    // (align-items:stretch is the grid default). Keeping every card
    // uniformly absolute avoids that mixed in-flow/absolute state
    // entirely — only the duration differs, not Flip participation.
    var animateMap = {};
    flipTargets.forEach(function(el){
      var id = el.getAttribute("data-flip-id");
      var newNear = isNearViewport(el.getBoundingClientRect());
      animateMap[id] = !!(oldNearMap[id] || newNear);
    });
    function flipDurationFor(i, target){
      return animateMap[target.getAttribute("data-flip-id")] ? flipDuration : 0;
    }
    function enterLeaveDurationFor(i, target){
      return isNearViewport(target.getBoundingClientRect()) ? flipDuration : 0;
    }

    // Suppress .character-card/.weapon-card's own transform transition
    // (normally used for the hover lift) for the duration of the Flip tween.
    // Without this, when Flip removes its inline transform override at the
    // end of each card's (staggered) tween, that's a discrete change the
    // CSS transition picks up and re-animates on its own with the spring
    // ease — an uncontrolled second bounce right after Flip's own.
    flipTargets.forEach(function(el){ el.classList.add("flip-suppress-transition"); });

    // .card's height is now locked at its OLD value (grid is already at its
    // real final size above, so .card would otherwise have already jumped
    // to match it) and tweened to the true final height captured just now,
    // on the same duration/ease as the Flip animation itself so the outer
    // card visibly resizing reads as one motion with the tiles inside it
    // settling, not two separately-timed animations.
    if(card){
      var cardNewHeight = card.offsetHeight;
      if(cardNewHeight !== cardOldHeight){
        gsap.fromTo(card, { height: cardOldHeight + "px" }, {
          height: cardNewHeight + "px",
          duration: flipDuration,
          ease: "power1.inOut",
          onComplete: function(){ card.style.height = ""; }
        });
      }
    }

    Flip.from(flipState, {
      targets: flipTargets,
      duration: flipDurationFor,
      ease: "power1.inOut",
      stagger: flipStagger,
      absolute: true,
      onEnter: function(elements){
        return gsap.fromTo(elements, { opacity:0, scale:0 }, { opacity:1, scale:1, duration:enterLeaveDurationFor, ease:"power1.inOut", stagger:flipStagger });
      },
      onLeave: function(elements){
        return gsap.to(elements, { opacity:0, scale:0, duration:enterLeaveDurationFor, ease:"power1.inOut" });
      },
      onComplete: function(){
        // Delayed by a couple of rAF ticks rather than removed synchronously
        // here: Flip's overall onComplete reflects the LAST staggered
        // target's tween finishing, but its own internal "clear my inline
        // transform overrides" cleanup for each target isn't guaranteed to
        // land on that exact same synchronous tick. Removing the
        // suppression class too early can re-arm the transition just
        // before that delayed cleanup fires, so it still catches it.
        var restoreTicks = 0;
        function restoreTransitionsNextTick(){
          restoreTicks++;
          if(restoreTicks < 2){ requestAnimationFrame(restoreTransitionsNextTick); return; }
          flipTargets.forEach(function(el){ el.classList.remove("flip-suppress-transition"); });
        }
        requestAnimationFrame(restoreTransitionsNextTick);
        grid.style.height = "";
      }
    });
  }
  function updateHamburgerIcon(open){
    var iconEl = document.getElementById("hamburgerIcon");
    var pathEl = document.getElementById("hamburgerIconPath");
    if(!iconEl || !pathEl) return;
    var targetPath = open ? CARET_LEFT_PATH_D : HAMBURGER_PATH_D;
    // A 180deg spin would leave the caret-left shape visually flipped into
    // a caret-right, which is the wrong direction (see our earlier
    // discussion — left is the correct "hide sidebar" convention here). A
    // full 360deg spin lands back at the same visual orientation (0deg ==
    // 360deg), so the caret genuinely reads as pointing left once it
    // settles, while still getting the spin effect. GSAP tracks the actual
    // rotation value (not normalized), so toggling the target between 0 and
    // 360 each time naturally reverses spin direction on open vs close.
    var targetRotation = open ? 360 : 0;
    if(!gsapReady()){
      pathEl.setAttribute("d", targetPath);
      iconEl.style.transform = "rotate(" + targetRotation + "deg)";
      return;
    }
    gsap.to(iconEl, { rotation: targetRotation, duration: 0.32, ease: "power2.out", transformOrigin: "50% 50%" });
    if(morphReady()){
      gsap.to(pathEl, { morphSVG: targetPath, duration: 0.32, ease: "power2.out" });
    } else {
      // Core GSAP loaded fine (icon still rotates) but MorphSVGPlugin's own
      // CDN request failed — snap the shape instantly rather than leaving
      // it stuck mid-way.
      pathEl.setAttribute("d", targetPath);
    }
  }
  function setSidebarOpen(open){
    var isOpen = document.documentElement.classList.contains("sidebar-open");
    if(open === isOpen) return;
    updateHamburgerIcon(open);
    var body = document.querySelector(".app-body");
    if(!body || prefersReducedMotion()){
      document.documentElement.classList.toggle("sidebar-open", open);
      return;
    }
    var invert = open ? -SIDEBAR_WIDTH : SIDEBAR_WIDTH;
    body.style.transition = "none";
    body.style.transform = "translateX(" + invert + "px)";
    document.documentElement.classList.toggle("sidebar-open", open);
    body.getBoundingClientRect(); // force layout now, before re-enabling the transition
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        body.style.transition = "";
        body.style.transform = "";
      });
    });
  }
  document.getElementById("hamburgerBtn").addEventListener("click", function(){
    if(isWideLayout()){
      setSidebarOpen(!document.documentElement.classList.contains("sidebar-open"));
    } else {
      openModal("navOverlay");
    }
  });
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape") closeModal("navOverlay");
  });
  // If the viewport crosses the breakpoint while one of the two panels is
  // open, close it rather than leaving it in a state that no longer
  // matches the current layout (e.g. the dropdown floating open at a width
  // that's now wide enough for the sidebar instead).
  var sidebarResizeQueued = false;
  window.addEventListener("resize", function(){
    if(sidebarResizeQueued) return;
    sidebarResizeQueued = true;
    requestAnimationFrame(function(){
      sidebarResizeQueued = false;
      if(isWideLayout()){ closeModal("navOverlay"); }
      else { setSidebarOpen(false); }
    });
  });

  /* ---------------------------------------------------------------------
   * Weapons view
   * ------------------------------------------------------------------- */
  // Tally how many times each weapon has been pulled, across every gacha
  // type (200/301/302/400) — a 4★ weapon can appear on the Character
  // Event, Weapon Event, or Standard banner, and a 5★ weapon on the
  // Weapon Event or Standard banner, so counts are combined regardless
  // of which banner the wish came from.
  function computeWeaponPullCounts(uid){
    var counts = {};
    var acct = db.accounts[uid];
    if(!acct) return counts;
    GACHA_TYPES.forEach(function(gt){
      (acct.pulls[gt] || []).forEach(function(p){
        if(p.item_type !== "Weapon") return;
        var key = normalizeName(p.name);
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    return counts;
  }

  // Splits a secondary-stat string like "CRIT DMG 44.1%" into a group label
  // ("CRIT DMG") and its numeric magnitude (44.1), so same-type stats group
  // together regardless of their exact roll, then order biggest-first within
  // that group. "-" (1★/2★ weapons with no real secondary stat) all collapse
  // into a single "No Secondary Stat" group.
  function parseSecondaryStat(s){
    if(!s || s === "-") return { label:"No Secondary Stat", value:0 };
    var m = s.match(/^(.*?)\s*([\d.]+)%?$/);
    if(m) return { label:m[1].trim(), value:parseFloat(m[2]) };
    return { label:s, value:0 };
  }

  function renderWeaponsView(){
    var uid = db.activeUid;
    var counts = uid ? computeWeaponPullCounts(uid) : {};

    var rows = weaponsList.map(function(w){
      var pulls = (counts[normalizeName(w.name)] || 0) + (w.manualPulls || 0);
      var parsedSecondary = parseSecondaryStat(w.secondary);
      return { id:w.id, name:w.name, type:w.type, rarity:w.rarity, atk:w.atk, secondary:w.secondary, secondaryGroup:parsedSecondary.label, secondaryValue:parsedSecondary.value, pulls:pulls };
    });

    // Filter: rarity toggles + weapon-type toggles + search term
    var term = weaponsSearchTerm.trim().toLowerCase();
    rows = rows.filter(function(r){
      if(!weaponsRarityFilter[r.rarity]) return false;
      if(!weaponsTypeFilter[r.type]) return false;
      if(term && r.name.toLowerCase().indexOf(term) === -1) return false;
      return true;
    });

    // Sort
    var col = weaponsSort, asc = weaponsSortAscMap[weaponsSort];
    rows.sort(function(a,b){
      var cmp = 0;
      if(col === "type"){
        cmp = a.type.localeCompare(b.type);
        if(cmp !== 0) return asc ? cmp : -cmp;
        return a.name.localeCompare(b.name); // always A-Z within a group, regardless of sort direction
      }
      else if(col === "secondary"){
        // Same grouping pattern as Type: alphabetical by group, then within a
        // group the biggest roll comes first, tied values fall back to A-Z
        // by name. 1★/2★ weapons (no real secondary stat) are merged into a
        // single "No Secondary Stat" group instead of each showing "-".
        cmp = a.secondaryGroup.localeCompare(b.secondaryGroup);
        if(cmp !== 0) return asc ? cmp : -cmp;
        cmp = b.secondaryValue - a.secondaryValue;
        if(cmp !== 0) return cmp;
        return a.name.localeCompare(b.name);
      }
      else if(col === "rarity"){
        cmp = a.rarity - b.rarity;
        if(cmp !== 0) return asc ? cmp : -cmp;
        // Within a rarity tier: pulled weapons always come first (regardless
        // of sort direction), then A-Z by name — same rule as the Characters
        // rarity sort (owned first, then name).
        var pulledCmp = (b.pulls>0?1:0) - (a.pulls>0?1:0);
        if(pulledCmp !== 0) return pulledCmp;
        return a.name.localeCompare(b.name);
      }
      else if(col === "pulls"){
        // Pulled weapons always lead (sorted by count), followed by the
        // always-lit 2★ group (name only), then the always-lit 1★ group
        // (name only), then any remaining unpulled 3★/4★/5★ weapons.
        function pullsGroup(r){
          if(r.rarity === 2) return 1; // always its own group — 2★ is always-lit regardless of any manual pull count
          if(r.rarity === 1) return 2; // same for 1★
          if(r.pulls > 0) return 0;
          return 3;
        }
        var ga = pullsGroup(a), gb = pullsGroup(b);
        if(ga !== gb) return ga - gb;
        if(ga === 0){
          cmp = a.pulls - b.pulls;
          if(!asc) cmp = -cmp;
          if(cmp !== 0) return cmp;
        }
        return a.name.localeCompare(b.name);
      }
      else {
        var av = a[col], bv = b[col];
        if(typeof av === "string"){ cmp = av.localeCompare(bv); }
        else { cmp = av - bv; }
        if(!asc) cmp = -cmp;
        if(cmp !== 0) return cmp;
        // Tie-break: same value in the sorted column always groups alphabetically
        // by name, regardless of the primary sort direction.
        if(col === "name") return 0;
        return a.name.localeCompare(b.name);
      }
    });

    var dirBtn = document.getElementById("weaponsSortDirBtn");
    if(dirBtn) dirBtn.classList.toggle("desc", !asc);

    var typeFilterDiv = document.getElementById("weaponsTypeFilterRow");
    if(typeFilterDiv && typeFilterDiv.innerHTML === ""){
      var typePillRow = document.createElement("div");
      typePillRow.className = "weapon-pill-row";
      ["Sword","Claymore","Polearm","Bow","Catalyst"].forEach(function(t){
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "weapon-pill-btn active";
        btn.title = t;
        btn.innerHTML = weaponIconMask(t, "#ffffff", 18);
        btn.addEventListener("click", function(){
          weaponsTypeFilter[t] = !weaponsTypeFilter[t];
          btn.classList.toggle("active", weaponsTypeFilter[t]);
          refreshWeaponsView();
        });
        typePillRow.appendChild(btn);
      });
      typeFilterDiv.appendChild(typePillRow);
    }

    var grid = document.getElementById("weaponsGrid");
    flipGridRebuild(grid, function(){
      if(rows.length === 0){
        grid.innerHTML = '<div class="empty-note" style="grid-column:1/-1; padding:20px; text-align:center;">No weapons match the current filters.</div>';
      } else {
        var lastGroupType = null;
        grid.innerHTML = rows.map(function(r){
          var groupHeader = "";
          if(col === "type" && r.type !== lastGroupType){
            lastGroupType = r.type;
            groupHeader = '<div class="character-group-header" data-flip-id="wep-hdr-type-'+escapeHtml(r.type)+'"><span class="element-badge lg">' + weaponIconMask(r.type, "currentColor", 16) + '</span>' + escapeHtml(r.type) + '</div>';
          }
          else if(col === "secondary" && r.secondaryGroup !== lastGroupType){
            lastGroupType = r.secondaryGroup;
            groupHeader = '<div class="character-group-header" data-flip-id="wep-hdr-sec-'+escapeHtml(r.secondaryGroup)+'">' + escapeHtml(r.secondaryGroup) + '</div>';
          }
          var imgUrl = weaponImageUrl(r.name);
          var isStatic = r.rarity <= 2; // 1★/2★ weapons can't be wished for — always shown lit, never greyed, and inert on hover
          var extraCls = (isStatic ? " static-tile" : (r.pulls>0 ? '' : ' no-pulls'));
          return groupHeader + '<div class="weapon-card rarity-'+r.rarity+extraCls+'" data-id="'+escapeHtml(r.id)+'" data-flip-id="wep-'+escapeHtml(r.id)+'" ' +
              'data-secondary="'+escapeHtml(r.secondary)+'" data-pulls="'+r.pulls+'" data-name="'+escapeHtml(r.name)+'">' +
            '<div class="weapon-portrait-wrap">' +
              '<img class="weapon-portrait" data-cache-src="'+escapeHtml(imgUrl)+'" alt="">' +
              '<div class="weapon-top-badges"><div class="weapon-info-pill" title="Base ATK">'+r.atk+' ATK</div></div>' +
              '<div class="weapon-card-actions"><button class="weapon-action-btn" data-edit="'+escapeHtml(r.id)+'">'+icon("pencil")+'</button></div>' +
            '</div>' +
            '<div class="weapon-info">' +
              '<div class="weapon-name-row"><span class="weapon-name">'+escapeHtml(r.name)+'</span>'+weaponIconMask(r.type, "#ffffff", 22)+'</div>' +
            '</div>' +
          '</div>';
        }).join("");
      }
    }, { animateCardHeight: true });

    grid.querySelectorAll(".weapon-action-btn[data-edit]").forEach(function(btn){
      btn.addEventListener("click", function(e){ e.stopPropagation(); openWeaponModal(btn.getAttribute("data-edit")); });
    });
    wireWeaponTooltip(grid);

    document.getElementById("weaponsCountCap").textContent = rows.length + " of " + weaponsList.length;
  }

  // Hover a weapon tile to see its secondary stat and total pull count —
  // same floating-tooltip pattern as the Pull History chart.
  function wireWeaponTooltip(grid){
    var tooltip = document.getElementById("weaponTooltip");
    var card = grid.closest(".weapons-card");
    grid.querySelectorAll(".weapon-card").forEach(function(tile){
      tile.addEventListener("mousemove", function(e){
        var name = tile.getAttribute("data-name");
        if(tile.classList.contains("static-tile")){
          tooltip.innerHTML = '<div class="tt-month">' + escapeHtml(name) + '</div>';
        } else {
          var secondary = tile.getAttribute("data-secondary"), pulls = tile.getAttribute("data-pulls");
          tooltip.innerHTML =
            '<div class="tt-month">' + escapeHtml(name) + '</div>' +
            '<div class="tt-row"><span>Secondary Stat</span><b>' + (secondary ? escapeHtml(secondary) : "\u2014") + '</b></div>' +
            '<div class="tt-total">Total pulls<b>' + pulls + '</b></div>';
        }
        var cardRect = card.getBoundingClientRect();
        tooltip.style.left = (e.clientX - cardRect.left) + "px";
        tooltip.style.top = (e.clientY - cardRect.top) + "px";
        tooltip.classList.add("show");
      });
      tile.addEventListener("mouseleave", function(){
        tooltip.classList.remove("show");
      });
    });
  }

  var WEAPON_SORT_LABELS = { name:"Name", type:"Type", rarity:"Rarity", atk:"ATK", secondary:"Secondary Stat", pulls:"Total Pull" };
  document.getElementById("weaponsSortBtn").addEventListener("click", function(e){
    e.stopPropagation();
    document.getElementById("weaponsSortDropdown").classList.toggle("open");
  });
  document.querySelectorAll("#weaponsSortPanel .sort-option").forEach(function(btn){
    btn.addEventListener("click", function(){
      var newSort = btn.getAttribute("data-sort");
      document.getElementById("weaponsSortDropdown").classList.remove("open");
      if(newSort === weaponsSort) return;
      weaponsSort = newSort;
      document.getElementById("weaponsSortLabel").textContent = WEAPON_SORT_LABELS[weaponsSort];
      document.querySelectorAll("#weaponsSortPanel .sort-option").forEach(function(b){ b.classList.toggle("active", b===btn); });
      refreshWeaponsView();
    });
  });
  document.addEventListener("click", function(e){
    var dd = document.getElementById("weaponsSortDropdown");
    if(dd && dd.classList.contains("open") && !dd.contains(e.target)){
      dd.classList.remove("open");
    }
  });
  document.getElementById("weaponsSortDirBtn").addEventListener("click", function(){
    weaponsSortAscMap[weaponsSort] = !weaponsSortAscMap[weaponsSort];
    refreshWeaponsView();
  });

  document.getElementById("weaponsSearch").addEventListener("input", function(e){
    weaponsSearchTerm = e.target.value;
    refreshWeaponsView();
  });

  document.getElementById("weaponsFilterToggle").addEventListener("click", function(){
    var bar = document.querySelector(".weapons-filterbar");
    var isOpen = bar.classList.toggle("open");
    this.classList.toggle("active", isOpen);
  });

  document.getElementById("weaponsRarityFilters").querySelectorAll(".icon-filter-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      var rank = btn.getAttribute("data-rank");
      weaponsRarityFilter[rank] = !weaponsRarityFilter[rank];
      btn.classList.toggle("active", weaponsRarityFilter[rank]);
      refreshWeaponsView();
    });
  });

  /* ---------------------------------------------------------------------
   * Add / Edit / Delete weapon modal
   * ------------------------------------------------------------------- */
  var editingWeaponId = null;
  var weaponModalType = "Sword";
  var weaponModalRarity = 5;
  var weaponModalPulls = null; // null = empty/0 total; otherwise the full displayed total pull count, no cap
  var weaponModalBaseComputed = 0; // pulls already derived from wish history for this weapon, captured when the modal opens

  function renderWeaponTypePicker(){
    var div = document.getElementById("weaponTypePicker");
    div.innerHTML = "";
    ["Sword","Claymore","Polearm","Bow","Catalyst"].forEach(function(t){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "modal-weapon-picker-btn" + (weaponModalType === t ? " active" : "");
      btn.title = t;
      btn.innerHTML = weaponIconMask(t, "#ffffff", 27);
      btn.addEventListener("click", function(){
        weaponModalType = t;
        renderWeaponTypePicker();
      });
      div.appendChild(btn);
    });
  }

  function renderWeaponRarityPicker(){
    var div = document.getElementById("weaponRarityPicker");
    div.innerHTML = "";
    var tiers = [ [5,"five"], [4,"four"], [3,"three"], [2,"two"], [1,"one"] ];
    tiers.forEach(function(pair){
      var r = pair[0], cls = pair[1];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rarity-pill " + cls + (weaponModalRarity === r ? " active" : "");
      btn.textContent = r + "★";
      btn.addEventListener("click", function(){
        weaponModalRarity = r;
        renderWeaponRarityPicker();
      });
      div.appendChild(btn);
    });
  }

  function renderWeaponPullsControl(){
    var valueEl = document.getElementById("weaponPullsValue");
    var minusBtn = document.getElementById("weaponPullsMinus");
    if(weaponModalPulls === null){
      valueEl.style.display = "none";
      minusBtn.disabled = true;
    } else {
      valueEl.style.display = "";
      valueEl.textContent = weaponModalPulls;
      minusBtn.disabled = false;
    }
  }

  document.getElementById("weaponPullsMinus").addEventListener("click", function(){
    if(weaponModalPulls === null) return;
    weaponModalPulls -= 1;
    if(weaponModalPulls <= 0) weaponModalPulls = null;
    renderWeaponPullsControl();
  });
  document.getElementById("weaponPullsPlus").addEventListener("click", function(){
    weaponModalPulls = weaponModalPulls === null ? 1 : weaponModalPulls + 1;
    renderWeaponPullsControl();
  });

  function openWeaponModal(id){
    editingWeaponId = id || null;
    var w = editingWeaponId ? weaponsList.find(function(x){ return x.id === editingWeaponId; }) : null;
    document.getElementById("weaponModalTitle").textContent = w ? "Edit Weapon" : "Add Weapon";
    document.getElementById("weaponName").value = w ? w.name : "";
    weaponModalType = w ? w.type : "Sword";
    weaponModalRarity = w ? w.rarity : 5;

    // The stepper shows the real total (wish-history count + any manual
    // adjustment), so editing an already-pulled weapon starts at its true
    // total instead of an empty manual-only delta.
    var uid = db.activeUid;
    var counts = uid ? computeWeaponPullCounts(uid) : {};
    weaponModalBaseComputed = w ? (counts[normalizeName(w.name)] || 0) : 0;
    var currentTotal = w ? (weaponModalBaseComputed + (w.manualPulls || 0)) : 0;
    weaponModalPulls = currentTotal > 0 ? currentTotal : null;

    renderWeaponTypePicker();
    renderWeaponRarityPicker();
    renderWeaponPullsControl();
    document.getElementById("weaponAtk").value = w ? w.atk : "";
    document.getElementById("weaponSecondary").value = w ? w.secondary : "";
    document.getElementById("deleteWeapon").style.display = w ? "inline-flex" : "none";
    openModal("weaponOverlay");
  }

  document.getElementById("openAddWeapon").addEventListener("click", function(){ openWeaponModal(null); });

  document.getElementById("saveWeapon").addEventListener("click", function(){
    var name = document.getElementById("weaponName").value.trim();
    var type = weaponModalType;
    var rarity = weaponModalRarity;
    var atk = parseInt(document.getElementById("weaponAtk").value, 10);
    var secondary = document.getElementById("weaponSecondary").value.trim();

    if(!name){ alert("Give the weapon a name."); return; }
    if(isNaN(atk) || atk <= 0){ alert("ATK should be a positive number."); return; }
    if(!secondary){ alert("Add a secondary stat (e.g. CRIT Rate, ATK%, Energy Recharge)."); return; }

    // manualPulls is stored as the difference between the total the user set
    // and what's already derived from wish history, so the displayed total
    // always matches exactly what they entered.
    var newTotal = weaponModalPulls || 0;
    var manual = newTotal - weaponModalBaseComputed;

    if(editingWeaponId){
      var w = weaponsList.find(function(x){ return x.id === editingWeaponId; });
      if(w){
        w.name = name; w.type = type; w.rarity = rarity; w.atk = atk; w.secondary = secondary;
        if(manual !== 0) w.manualPulls = manual; else delete w.manualPulls;
      }
    } else {
      var id = "w_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_" + Date.now().toString(36);
      var newWeapon = { id:id, name:name, type:type, rarity:rarity, atk:atk, secondary:secondary };
      if(manual !== 0) newWeapon.manualPulls = manual;
      weaponsList.push(newWeapon);
    }
    saveWeapons();
    closeModal("weaponOverlay");
    refreshWeaponsView();
  });

  document.getElementById("deleteWeapon").addEventListener("click", function(){
    if(!editingWeaponId) return;
    if(!confirm("Remove this weapon from the list? Any recorded pulls for it will just show up as an unmatched name.")) return;
    weaponsList = weaponsList.filter(function(x){ return x.id !== editingWeaponId; });
    saveWeapons();
    closeModal("weaponOverlay");
    refreshWeaponsView();
  });

  function pityBadge(s, isFive){
    var cap = isFive ? s.pity5Cap : s.pity4Cap;
    var current = isFive ? s.currentPity5 : s.currentPity4;
    var showArrow = isFive ? s.guaranteedNext : s.guaranteedNext4;
    var tierLabel = isFive ? "5★" : "4★";
    var numId = "stat-" + s.key + "-" + (isFive ? "p5" : "p4");
    var html = "";
    if(showArrow) html += '<span class="arrow" title="Next ' + tierLabel + ' is guaranteed to be the rate-up">' + icon("arrowUp") + '</span>';
    html += '<span id="' + numId + '">' + current + '</span><span style="color:var(--muted-2); font-size:0.9rem;">/' + cap + '</span>';
    return html;
  }

  // shadcn Progress, adapted: Track > Indicator, with the "[gem] X / Y wishes
  // to Z pulls" cost — previously a standalone line in the card header — now
  // living as the value line under the bar it describes. Standard banner has
  // no pity-buffer target, so it just shows the bare progress rail.
  function pityPct(s){
    var cap = s.pity5Cap || 1;
    return Math.max(0, Math.min(100, (s.currentPity5 / cap) * 100));
  }
  function pityProgressBar(s){
    var pct = pityPct(s);
    var color = pityColor(s.currentPity5 || 1, s.pity5Cap);
    var valueRow = "";
    if(s.kind === "limited"){
      var effTarget = Math.max(1, s.pity5Cap - (settings.pityBuffer || 0));
      var pullsLeft = Math.max(0, effTarget - s.currentPity5);
      var primogemsLeft = pullsLeft * PRIMOGEMS_PER_WISH;
      var costLine = pullsLeft > 0 ? (icon("gem") + fmt(primogemsLeft) + " / " + icon("sparkles") + fmt(pullsLeft)) : "";
      var targetLine = pullsLeft > 0 ? ("to " + effTarget + " pulls") : ("Guaranteed at " + effTarget + " pulls");
      valueRow = '<div class="pity-progress-value">' +
          '<span class="pity-progress-cost">' + costLine + '</span>' +
          '<span class="pity-progress-target">' + targetLine + '</span>' +
        '</div>';
    }
    return '<div class="pity-progress">' +
        '<div class="pity-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="' + s.pity5Cap + '" aria-valuenow="' + s.currentPity5 + '" aria-label="5-star pity progress">' +
          '<div class="pity-progress-indicator" id="bar-' + s.key + '-p5" style="width:' + pct.toFixed(2) + '%; background:' + color + ';"></div>' +
        '</div>' +
        valueRow +
      '</div>';
  }

  /* -------------------------------------------------------------------
   * Year picker (shadcn DropdownMenu + DropdownMenuRadioGroup pattern)
   * ---------------------------------------------------------------------
   * Builds a trigger button + floating radio-item panel, functionally
   * equivalent to the native <select> it replaces: opts.years (ascending),
   * opts.selected ("all" or a year string), opts.includeAll, and
   * opts.onChange(newValue). Returns {root, setSelected} so callers can
   * mount `root` and update the value programmatically if needed.
   * ------------------------------------------------------------------- */
  function buildYearMenu(opts){
    var root = document.createElement("div");
    root.className = "ymenu" + (opts.extraClass ? " " + opts.extraClass : "");

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ymenu-trigger";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    var valueSpan = document.createElement("span");
    valueSpan.className = "ymenu-value";
    trigger.appendChild(valueSpan);
    trigger.insertAdjacentHTML("beforeend", icon("chevronDown", "ymenu-chevron"));
    root.appendChild(trigger);

    var content = document.createElement("div");
    content.className = "ymenu-content";
    content.setAttribute("role", "menu");
    root.appendChild(content);

    function labelFor(v){ return v === "all" ? "All" : v; }

    var optionValues = (opts.includeAll ? ["all"] : []).concat(opts.years.slice().reverse());
    var items = optionValues.map(function(v){
      var item = document.createElement("button");
      item.type = "button";
      item.className = "ymenu-radio-item";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("data-value", v);
      item.innerHTML = '<span class="ymenu-indicator"><span class="ymenu-dot"></span></span>' + escapeHtml(labelFor(v));
      item.addEventListener("click", function(){
        setSelected(v);
        closeMenu();
        if(opts.onChange) opts.onChange(v);
      });
      content.appendChild(item);
      return item;
    });

    function setSelected(v){
      valueSpan.textContent = labelFor(v);
      items.forEach(function(item){
        item.setAttribute("aria-checked", item.getAttribute("data-value") === v ? "true" : "false");
      });
    }

    function openMenu(){
      root.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
      // Default alignment is right-aligned (flush with the trigger's right
      // edge, growing leftward) — right for the common case where the
      // trigger sits at the right end of a flex row. On narrow viewports
      // the row can wrap and put the trigger near the left edge instead,
      // which would push a right-aligned panel off-screen — so measure
      // after opening and flip to left-aligned if it would overflow.
      content.classList.remove("align-left");
      var rect = content.getBoundingClientRect();
      if(rect.left < 4){
        content.classList.add("align-left");
      }
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKeydown, true);
    }
    function closeMenu(){
      root.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKeydown, true);
    }
    function onDocClick(e){ if(!root.contains(e.target)) closeMenu(); }
    function onKeydown(e){ if(e.key === "Escape"){ closeMenu(); trigger.focus(); } }
    trigger.addEventListener("click", function(){
      if(root.classList.contains("open")) closeMenu(); else openMenu();
    });

    setSelected(opts.selected);
    return { root: root, setSelected: setSelected };
  }

  var chipsYearState = {}; // bannerKey -> selected year, so the 5★ chip list stays short instead of growing forever

  function buildChipsSection(s){
    if(!s.fiveStars.length) return null;
    var wrap = document.createElement("div");

    // Figure out which years this banner actually has 5★ pulls in, and
    // default to the most recent one (like Pull History does) so the chip
    // list doesn't keep accumulating and blowing out the page height. An
    // "All" option is also offered so the full history can still be viewed
    // on demand.
    var yearsSet = {};
    s.fiveStars.forEach(function(f){ var y = (f.time||"").slice(0,4); if(y) yearsSet[y] = true; });
    var years = Object.keys(yearsSet).sort();
    if(years.length === 0) years = [String(new Date().getFullYear())];
    var prevSel = chipsYearState[s.key];
    var selYear = (prevSel === "all" || (prevSel && years.indexOf(prevSel) !== -1)) ? prevSel : years[years.length-1];
    chipsYearState[s.key] = selYear;

    var headerRow = document.createElement("div");
    headerRow.className = "chip-header-row";
    var chipLabel = document.createElement("div");
    chipLabel.className = "chip-label";
    chipLabel.textContent = s.kind === "limited" ? "5★ Pulls \u2014 50/50 outcome & pity" : "5★ Pulls \u2014 pity";
    headerRow.appendChild(chipLabel);
    if(years.length > 1){
      var yearMenu = buildYearMenu({
        years: years,
        selected: selYear,
        includeAll: true,
        onChange: function(v){
          chipsYearState[s.key] = v;
          // Scoped swap, same pattern as refreshPullTable() below for the
          // rarity filters/sort toggle — rebuild just this card's chips
          // section and replace it in place instead of calling renderAll(),
          // so the rest of the page (other cards, the history chart, etc.)
          // never gets touched and nothing blinks.
          var parent = wrap.parentNode;
          if(!parent) return;
          var freshChips = buildChipsSection(s);
          if(freshChips){
            parent.replaceChild(freshChips, wrap);
          } else {
            parent.removeChild(wrap);
          }
        }
      });
      headerRow.appendChild(yearMenu.root);
    }
    wrap.appendChild(headerRow);

    var filtered = selYear === "all" ? s.fiveStars : s.fiveStars.filter(function(f){ return (f.time||"").slice(0,4) === selYear; });

    var chipsWrap = document.createElement("div");
    chipsWrap.className = "rarity-grid";
    if(filtered.length === 0){
      chipsWrap.innerHTML = '<span class="empty-note">No 5★ pulls in ' + escapeHtml(selYear) + '.</span>';
    } else {
      chipsWrap.innerHTML = filtered.slice().reverse().map(function(f){
        var cls, guaranteedCls = "";
        if(s.kind === "limited"){
          cls = f.isStd ? "lose" : "win";
          if(!f.isStd && f.guaranteed) guaranteedCls = " guaranteed";
        } else {
          cls = "win"; // Standard banner has no win/lose concept — just show gold like the old "plain" chip did
        }
        var imgUrl = f.item_type === "Character" ? characterImageUrl(f.name) : weaponImageUrl(f.name);
        var elBadge = "";
        if(f.item_type === "Character"){
          var el = characterElementByName(f.name);
          var elMeta = el ? ELEMENT_ICONS[el] : null;
          elBadge = '<span class="element-badge sm" title="' + escapeHtml(el||"") + '" style="' + (elMeta ? ("background:"+elMeta.color+";color:"+elMeta.text+";") : "") + '">' + (elMeta ? elementIcon(el) : icon("gem")) + '</span>';
        } else {
          var wType = weaponTypeByName(f.name);
          if(wType) elBadge = '<span class="element-badge sm" title="' + escapeHtml(wType) + '" style="background:var(--line);">' + weaponIconMask(wType, "var(--text)", 10) + '</span>';
        }
        return '<div class="rarity-card ' + cls + guaranteedCls + '" title="' + escapeHtml(f.time) + '">' +
          '<div class="portrait-box"><img src="' + escapeHtml(imgUrl) + '" alt="" onerror="this.remove()"></div>' +
          elBadge +
          '<div class="info-bar ' + cls + '">' +
            '<div class="name">' + escapeHtml(f.name) + '</div>' +
            '<div class="meta"><span class="time">' + escapeHtml(f.time.slice(0,10)) + '</span><span class="pity" style="color:' + pityColor(f.pity, s.pity5Cap) + ';">' + f.pity + '</span></div>' +
          '</div>' +
        '</div>';
      }).join("");
    }
    wrap.appendChild(chipsWrap);

    return wrap;
  }

  // Looks up how much time is left on the currently-active banner of this
  // type, using the same imported Timeline data (act_calendar) that powers
  // the 4★ rate-up lookup and the Gantt chart. If more than one banner of
  // that category is running at once (e.g. Character Event Wish + Wish 2),
  // the soonest end date wins, since that's the one that's actually urgent.
  // Returns milliseconds remaining, or null when there's no imported banner
  // covering right now.
  function msUntilBannerEnds(bannerKey){
    var category = bannerKey === "character" ? "character-banner" : bannerKey === "weapon" ? "weapon-banner" : null;
    if(!category) return null;
    var now = Date.now();
    var soonestEnd = null;
    timelineEntries.forEach(function(e){
      if(e.category !== category) return;
      if(now < e.start || now > e.end) return;
      if(soonestEnd === null || e.end < soonestEnd) soonestEnd = e.end;
    });
    if(soonestEnd === null) return null;
    return Math.max(0, soonestEnd - now);
  }

  // "3d 5h" once there's at least a full day left, "5h 32m" once it drops
  // under a day, so the badge gets more precise as the deadline gets closer.
  function formatBannerCountdown(ms){
    if(ms <= 0) return "any moment";
    var totalMinutes = Math.floor(ms / 60000);
    if(totalMinutes < 24*60){
      var hours = Math.floor(totalMinutes / 60);
      var minutes = totalMinutes % 60;
      return hours + "h " + minutes + "m";
    }
    var days = Math.floor(totalMinutes / (24*60));
    var remHours = Math.floor((totalMinutes - days*24*60) / 60);
    return days + "d " + remHours + "h";
  }

  function renderCard(s){
    var card = document.createElement("div");
    card.className = "card";
    var endsBadge = "";
    if(s.kind === "limited"){
      var msLeft = msUntilBannerEnds(s.key);
      if(msLeft !== null){
        endsBadge = '<span class="ends-badge">' + formatBannerCountdown(msLeft) + '</span>';
      }
    }
    card.innerHTML =
      '<h2><span class="h2-title-group">' + s.label + endsBadge + '</span></h2>' +
      '<div class="stat-row"><div class="stat-label"><span class="t">Lifetime Pulls</span><span class="d">' + icon("gem") + ' ' + fmt(s.total*PRIMOGEMS_PER_WISH) + ' primogems</span></div><div class="stat-value" id="stat-' + s.key + '-total">' + fmt(s.total) + '</div></div>' +
      '<div class="stat-row"><div class="stat-label"><span class="t">5★ Pity</span><span class="d">Guaranteed at ' + s.pity5Cap + '</span></div><div class="stat-value gold">' + pityBadge(s,true) + '</div></div>' +
      pityProgressBar(s) +
      '<div class="stat-row"><div class="stat-label"><span class="t">4★ Pity</span><span class="d">Guaranteed at ' + s.pity4Cap + '</span></div><div class="stat-value purple">' + pityBadge(s,false) + '</div></div>' +
      '<div class="chips-slot" id="chips-' + s.key + '"></div>' +
      '<button class="toggle-details" data-key="' + s.key + '" title="' + (openDetails[s.key] ? "Hide details" : "Show details") + '">' +
        icon("chevronDown", "", 'id="toggleIcon-' + s.key + '" style="transform:rotate(' + (openDetails[s.key] ? 180 : 0) + 'deg);"') +
      '</button>' +
      '<div class="details ' + (openDetails[s.key] ? "open" : "") + '" id="details-' + s.key + '"></div>';
    card.querySelector(".toggle-details").addEventListener("click", function(evt){
      var btn = evt.currentTarget;
      var willOpen = !openDetails[s.key];
      openDetails[s.key] = willOpen;
      btn.title = willOpen ? "Hide details" : "Show details";

      // Same shape (chevronDown) rotated 180deg reads as chevronUp, so this
      // spins the persistent icon rather than swapping glyphs. Duration
      // matches slideDetailsOpen/slideDetailsClosed exactly (0.36s opening,
      // 0.26s closing) so the caret and the panel settle together — the
      // spin itself uses power2.out both ways, even though the panel's own
      // closing tween (slideDetailsClosed) stays power2.in.
      var iconEl = document.getElementById("toggleIcon-" + s.key);
      if(iconEl){
        var targetRotation = willOpen ? 180 : 0;
        if(gsapReady()){
          gsap.to(iconEl, {
            rotation: targetRotation,
            duration: willOpen ? 0.36 : 0.26,
            ease: "power2.out",
            transformOrigin: "50% 50%"
          });
        } else {
          iconEl.style.transform = "rotate(" + targetRotation + "deg)";
        }
      }

      var chipsSlot = card.querySelector("#chips-" + s.key);
      var detailsDiv = card.querySelector("#details-" + s.key);

      if(willOpen){
        if(chipsSlot) chipsSlot.innerHTML = "";
        detailsDiv.innerHTML = "";
        detailsDiv.appendChild(renderDetails(s));
        detailsDiv.classList.add("open");
        slideDetailsOpen(detailsDiv);
      } else {
        slideDetailsClosed(detailsDiv, function(){
          detailsDiv.classList.remove("open");
          detailsDiv.innerHTML = "";
          if(chipsSlot){
            var chips = buildChipsSection(s);
            if(chips) chipsSlot.appendChild(chips);
          }
        });
      }
    });
    if(!openDetails[s.key]){
      var chipsSlot = card.querySelector("#chips-" + s.key);
      var chips = buildChipsSection(s);
      if(chips) chipsSlot.appendChild(chips);
    }
    var detailsDiv = card.querySelector("#details-" + s.key);
    if(openDetails[s.key]) detailsDiv.appendChild(renderDetails(s));
    return card;
  }

  function renderDetails(s){
    var wrap = document.createElement("div");

    var rows = "";
    rows += '<tr class="rowgold"><td>5★</td><td class="num">' + s.count5 + '</td><td class="num">' + fmt1(s.pct5) + '%</td><td class="num">' + fmt1(s.avgPity5) + '</td></tr>';
    if(s.kind === "limited" && (s.win5+s.lose5) > 0){
      var winLabel = s.key==="weapon" ? "Win 75:25" : "Win 50:50";
      rows += '<tr class="rowsub"><td>' + winLabel + '</td><td class="num">' + s.win5 + '</td><td class="num">' + fmt1(s.winPct5) + '%</td><td class="num">-</td></tr>';
    }
    if(s.kind === "standard" && s.count5 > 0){
      rows += '<tr class="rowsub"><td>Character</td><td class="num">' + s.char5 + '</td><td class="num">' + fmt1(s.count5? s.char5/s.count5*100:0) + '%</td><td class="num">-</td></tr>';
      rows += '<tr class="rowsub"><td>Weapon</td><td class="num">' + s.wep5 + '</td><td class="num">' + fmt1(s.count5? s.wep5/s.count5*100:0) + '%</td><td class="num">-</td></tr>';
    }
    rows += '<tr class="rowpurple"><td>4★</td><td class="num">' + s.count4 + '</td><td class="num">' + fmt1(s.pct4) + '%</td><td class="num">' + fmt1(s.avgPity4) + '</td></tr>';
    rows += '<tr class="rowsub"><td>Character</td><td class="num">' + s.char4 + '</td><td class="num">' + (s.count4? fmt1(s.char4/s.count4*100):"0.0") + '%</td><td class="num">-</td></tr>';
    rows += '<tr class="rowsub"><td>Weapon</td><td class="num">' + s.wep4 + '</td><td class="num">' + (s.count4? fmt1(s.wep4/s.count4*100):"0.0") + '%</td><td class="num">-</td></tr>';

    var table = document.createElement("table");
    table.className = "mini";
    table.innerHTML = '<thead><tr><th></th><th class="num">Total</th><th class="num">Percent</th><th class="num">Pity Avg</th></tr></thead><tbody>' + rows + '</tbody>';
    wrap.appendChild(table);

    if(!rarityFilters[s.key]) rarityFilters[s.key] = { 5:true, 4:true, 3:false };
    if(sortAsc[s.key] === undefined) sortAsc[s.key] = false;
    var filt = rarityFilters[s.key];

    var filterRow = document.createElement("div");
    filterRow.className = "rarity-filters";
    filterRow.innerHTML =
      '<button class="rarity-pill five' + (filt[5] ? " active" : "") + '" data-rank="5">5★</button>' +
      '<button class="rarity-pill four' + (filt[4] ? " active" : "") + '" data-rank="4">4★</button>' +
      '<button class="rarity-pill three' + (filt[3] ? " active" : "") + '" data-rank="3">3★</button>' +
      '<button class="sort-toggle-btn" title="Toggle sort order">' + icon("chevronsUpDown") + '</button>';
    wrap.appendChild(filterRow);

    filterRow.querySelectorAll(".rarity-pill").forEach(function(btn){
      btn.addEventListener("click", function(){
        var rank = btn.getAttribute("data-rank");
        filt[rank] = !filt[rank];
        btn.classList.toggle("active", filt[rank]);
        refreshPullTable();
      });
    });
    filterRow.querySelector(".sort-toggle-btn").addEventListener("click", function(){
      sortAsc[s.key] = !sortAsc[s.key];
      refreshPullTable();
    });

    function refreshPullTable(){
      var oldWrap = wrap.querySelector(".pull-table-wrap");
      var newWrap = buildPullTableWrap(s);
      if(oldWrap && oldWrap.parentNode){
        oldWrap.parentNode.replaceChild(newWrap, oldWrap);
      } else {
        wrap.appendChild(newWrap);
      }
      if(gsapReady()) gsap.fromTo(newWrap, { opacity:0 }, { opacity:1, duration:0.22, ease:"power1.out" });
    }

    wrap.appendChild(buildPullTableWrap(s));
    return wrap;
  }

  // Builds just the sortable/filterable pull-history table for a banner's
  // details panel — split out so the rarity/sort controls can rebuild only
  // this piece instead of the whole details panel or the whole page.
  function buildPullTableWrap(s){
    var filt = rarityFilters[s.key];
    var combined = [];
    if(filt[5]) s.fiveStars.forEach(function(f){ combined.push({ rank:"5", name:f.name, time:f.time, pity:f.pity }); });
    if(filt[4]) s.fourStars.forEach(function(f){ combined.push({ rank:"4", name:f.name, time:f.time, pity:f.pity }); });
    if(filt[3]) s.threeStars.forEach(function(f){ combined.push({ rank:"3", name:f.name, time:f.time, pity:f.pity }); });
    combined.sort(function(a,b){
      if(a.time < b.time) return sortAsc[s.key] ? -1 : 1;
      if(a.time > b.time) return sortAsc[s.key] ? 1 : -1;
      return 0;
    });

    var tableWrap = document.createElement("div");
    tableWrap.className = "pull-table-wrap";
    if(combined.length === 0){
      var pullNote = document.createElement("div");
      pullNote.className = "empty-note";
      pullNote.style.padding = "14px";
      pullNote.textContent = "No pulls match the selected filters.";
      tableWrap.appendChild(pullNote);
    } else {
      var rankClass = { "5":"five", "4":"four", "3":"three" };
      var bodyRows = combined.map(function(p){
        return '<tr><td class="name ' + rankClass[p.rank] + '">' + escapeHtml(p.name) + '</td><td class="time">' + escapeHtml(p.time) + '</td><td class="num pity">' + p.pity + '</td></tr>';
      }).join("");
      var ptable = document.createElement("table");
      ptable.className = "pulls";
      ptable.innerHTML = '<thead><tr><th>Name</th><th>Time</th><th class="num">Pity</th></tr></thead><tbody>' + bodyRows + '</tbody>';
      tableWrap.appendChild(ptable);
    }
    return tableWrap;
  }

  function escapeHtml(str){
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  var historyState = { buckets:{}, selectedYear:null };
  var MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var MIN_HISTORY_MONTHS = 12;

  function renderHistoryChart(allStats){
    var wrap = document.getElementById("historyWrap");
    var yearMenuSlot = document.getElementById("historyYearMenuSlot");
    var allPulls = [];
    ["character","weapon","standard"].forEach(function(k){
      allPulls = allPulls.concat(allStats[k].pulls);
    });
    if(allPulls.length === 0){ wrap.style.display = "none"; return; }
    wrap.style.display = "block";
    allPulls.sort(sortByTimeThenId);

    var buckets = {}; // "YYYY-MM" -> {5:n,4:n,3:n}
    var yearsSet = {};
    allPulls.forEach(function(p){
      var month = (p.time||"").slice(0,7);
      if(!month) return;
      if(!buckets[month]) buckets[month] = {5:0,4:0,3:0};
      buckets[month][p.rank_type] = (buckets[month][p.rank_type]||0) + 1;
      yearsSet[month.slice(0,4)] = true;
    });
    historyState.buckets = buckets;

    var years = Object.keys(yearsSet).sort();
    if(years.length === 0) years = [String(new Date().getFullYear())];

    var prevSelected = historyState.selectedYear;
    var desiredYear = (prevSelected && years.indexOf(prevSelected) !== -1) ? prevSelected : years[years.length-1];
    historyState.selectedYear = desiredYear;

    yearMenuSlot.innerHTML = "";
    var historyYearMenu = buildYearMenu({
      years: years,
      selected: desiredYear,
      includeAll: false,
      onChange: function(v){
        historyState.selectedYear = v;
        drawHistoryChart(v);
      }
    });
    yearMenuSlot.appendChild(historyYearMenu.root);

    drawHistoryChart(desiredYear);
  }

  // Builds a rect-shaped SVG path with independent left/right corner radii,
  // so a stacked bar segment can have rounded outer corners and square
  // inner seams (rl/rr = 0 for a plain square edge on that side).
  function roundedStackPath(x, y, w, h, rl, rr){
    rl = Math.min(rl, h/2, w/2);
    rr = Math.min(rr, h/2, w/2);
    return "M" + (x+rl) + "," + y +
      " H" + (x+w-rr) +
      (rr > 0 ? " A" + rr + "," + rr + " 0 0 1 " + (x+w) + "," + (y+rr) : "") +
      " V" + (y+h-rr) +
      (rr > 0 ? " A" + rr + "," + rr + " 0 0 1 " + (x+w-rr) + "," + (y+h) : "") +
      " H" + (x+rl) +
      (rl > 0 ? " A" + rl + "," + rl + " 0 0 1 " + x + "," + (y+h-rl) : "") +
      " V" + (y+rl) +
      (rl > 0 ? " A" + rl + "," + rl + " 0 0 1 " + (x+rl) + "," + y : "") +
      " Z";
  }

  function drawHistoryChart(year){
    var svg = document.getElementById("historyChart");
    var buckets = historyState.buckets || {};

    // Always show all 12 months (Jan–Dec of the selected year), padding with
    // zero-pull months where no data exists yet. Laid out as vertical rows
    // (one per month) with horizontal stacked bars, so the chart reads top
    // to bottom rather than needing wide horizontal space — this fits the
    // narrower bento-box card much better than a column chart would.
    var months = [];
    for(var m=1;m<=12;m++){
      months.push(year + "-" + (m<10?"0":"") + m);
    }
    if(months.length < MIN_HISTORY_MONTHS){
      while(months.length < MIN_HISTORY_MONTHS) months.push(months[months.length-1]);
    }

    var maxTotal = 0;
    months.forEach(function(mo){
      var b = buckets[mo] || {5:0,4:0,3:0};
      maxTotal = Math.max(maxTotal, b[5]+b[4]+b[3]);
    });
    if(maxTotal === 0) maxTotal = 1;

    var W = 500;
    var rowH = 22, rowGap = 8;
    var labelW = 34, countW = 34;
    var barX = labelW + 6;
    var barW = W - barX - countW;
    var H = months.length * (rowH + rowGap) + rowGap;
    var svgParts = [];

    months.forEach(function(mo, idx){
      var b = buckets[mo] || {5:0,4:0,3:0};
      var total = b[5]+b[4]+b[3];
      var rowY = idx * (rowH + rowGap) + rowGap;
      var x = barX;

      // full-row invisible hit area, so hovering blank space in an empty month still shows the tooltip
      svgParts.push('<rect class="hit-rect" data-month="'+mo+'" data-five="'+b[5]+'" data-four="'+b[4]+'" data-three="'+b[3]+'" data-total="'+total+'" x="0" y="'+rowY+'" width="'+W+'" height="'+rowH+'" fill="transparent"></rect>');
      svgParts.push('<rect class="hover-col" data-hover-col="'+idx+'" x="0" y="'+rowY+'" width="'+W+'" height="'+rowH+'"></rect>');

      svgParts.push('<text class="month-label" x="0" y="'+(rowY+rowH/2+3)+'" text-anchor="start">'+MONTH_ABBR[idx % 12]+'</text>');

      // stack left-to-right: 3 (blue), 4 (purple), 5 (gold). Only the outer
      // edge of the whole stack gets rounded — like shadcn's stacked-bar
      // radius prop, which rounds the outermost segment's outer corners and
      // leaves the seams between segments square.
      var segs = [ [b[3], "var(--blue)"], [b[4], "var(--purple)"], [b[5], "var(--gold)"] ];
      var nonZeroIdx = [];
      segs.forEach(function(seg, i){ if(seg[0] > 0) nonZeroIdx.push(i); });
      var firstIdx = nonZeroIdx[0], lastIdx = nonZeroIdx[nonZeroIdx.length-1];
      segs.forEach(function(seg, i){
        var w = (seg[0]/maxTotal) * (barW-4);
        if(w > 0){
          var rl = (i === firstIdx) ? 4 : 0;
          var rr = (i === lastIdx) ? 4 : 0;
          var d = roundedStackPath(x, rowY+2, w, rowH-4, rl, rr);
          svgParts.push('<path class="bar-seg" data-month="'+mo+'" data-five="'+b[5]+'" data-four="'+b[4]+'" data-three="'+b[3]+'" data-total="'+total+'" d="'+d+'" fill="'+seg[1]+'" style="pointer-events:none;"></path>');
          x += w;
        }
      });

      if(total>0){
        svgParts.push('<text class="month-label" x="'+(W-2)+'" y="'+(rowY+rowH/2+3)+'" text-anchor="end">'+total+'</text>');
      }
    });

    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("height", H);
    svg.innerHTML = svgParts.join("");
    wireHistoryTooltip(svg);
  }

  function wireHistoryTooltip(svg){
    var tooltip = document.getElementById("historyTooltip");
    var card = svg.closest(".chart-card");
    svg.querySelectorAll(".hit-rect").forEach(function(rect){
      rect.addEventListener("mousemove", function(e){
        var five = rect.getAttribute("data-five"), four = rect.getAttribute("data-four"),
            three = rect.getAttribute("data-three"), total = rect.getAttribute("data-total"),
            month = rect.getAttribute("data-month");
        tooltip.innerHTML =
          '<div class="tt-month">' + escapeHtml(month) + '</div>' +
          '<div class="tt-row"><span class="tt-dot five"></span>5★ pulls<b>' + five + '</b></div>' +
          '<div class="tt-row"><span class="tt-dot four"></span>4★ pulls<b>' + four + '</b></div>' +
          '<div class="tt-row"><span class="tt-dot three"></span>3★ pulls<b>' + three + '</b></div>' +
          '<div class="tt-total">Total pulls<b>' + total + '</b></div>';
        var cardRect = card.getBoundingClientRect();
        tooltip.style.left = (e.clientX - cardRect.left) + "px";
        tooltip.style.top = (e.clientY - cardRect.top) + "px";
        tooltip.classList.add("show");
      });
      rect.addEventListener("mouseenter", function(){
        var idx = Array.prototype.indexOf.call(svg.querySelectorAll(".hit-rect"), rect);
        var hoverCols = svg.querySelectorAll("[data-hover-col]");
        hoverCols.forEach(function(hc){ hc.style.opacity = (hc.getAttribute("data-hover-col") === String(idx)) ? "0.06" : "0"; });
      });
      rect.addEventListener("mouseleave", function(){
        tooltip.classList.remove("show");
        svg.querySelectorAll("[data-hover-col]").forEach(function(hc){ hc.style.opacity = "0"; });
      });
    });
  }

  /* ---------------------------------------------------------------------
   * Star field background (decorative). Ported from bundui's "Stars"
   * component (box-shadow star layers) to plain JS/CSS:
   * - generateStarShadows() builds one box-shadow string per layer; each
   *   layer's actual DOM footprint is just two 1-3px dots, with the shadow
   *   list doing the work of hundreds of "stars" for free.
   * - The vertical infinite-scroll loop (@keyframes starDrift, in the CSS
   *   above) is a plain CSS animation, not GSAP — a simple linear loop with
   *   no interaction, so there's no benefit to ticking it on the JS side.
   *   It's applied as an inline `animation` shorthand from buildStarLayer()
   *   rather than as a CSS default, guarded by an explicit
   *   prefersReducedMotion() check there (not gsapReady() — this part has
   *   nothing to do with GSAP being loaded): the near/large layer needs a
   *   second "twinkle" animation alongside the drift, and setting the full
   *   shorthand inline is the only way to add that without one animation
   *   silently overwriting the other. That means a stylesheet media query
   *   can no longer un-set it afterward the way it could when this was a
   *   plain CSS default, hence checking in JS before ever applying it.
   * ------------------------------------------------------------------- */
  function generateStarShadows(count, color){
    var parts = [];
    for(var i=0;i<count;i++){
      var x = Math.floor(Math.random()*4000)-2000;
      var y = Math.floor(Math.random()*4000)-2000;
      parts.push(x+"px "+y+"px "+color);
    }
    return parts.join(", ");
  }
  function buildStarLayer(parent, count, size, color, durationSec, twinkle){
    var layer = document.createElement("div");
    layer.className = "star-layer";
    if(!prefersReducedMotion()){
      layer.style.animation = twinkle
        ? ("starDrift " + durationSec + "s linear infinite, starTwinkle 4s ease-in-out infinite")
        : ("starDrift " + durationSec + "s linear infinite");
    }
    var shadow = generateStarShadows(count, color);
    [0, 2000].forEach(function(topOffset){
      var dot = document.createElement("div");
      dot.className = "star-dot";
      dot.style.width = dot.style.height = size+"px";
      dot.style.top = topOffset+"px";
      dot.style.boxShadow = shadow;
      layer.appendChild(dot);
    });
    parent.appendChild(layer);
  }
  function buildStarField(){
    var container = document.getElementById("starField");
    var parallax = document.createElement("div");
    parallax.className = "star-parallax";
    parallax.id = "starParallax";
    container.appendChild(parallax);

    var speed = 50; // seconds for the smallest/farthest layer's full loop
    buildStarLayer(parallax, 1000, 1, "#fff", speed);
    buildStarLayer(parallax, 400, 2, "#fff", speed*2);
    buildStarLayer(parallax, 200, 3, "#fff", speed*3, true);
  }

  /* ---------------------------------------------------------------------
   * Timeline view — Gantt chart, paimon.moe style
   * ------------------------------------------------------------------- */
  // Fixed lane categories, in the order they're stacked top-to-bottom. Each
  // has its own match() so raw "act" entries get sorted into a dedicated
  // lane (Spiral Abyss / Imaginarium Theater / Battle Pass) by name when
  // recognized, falling back to a shared "Events & Challenges" pool of
  // overlap-packed lanes for genuine one-off acts. A whole section is
  // skipped entirely (no label, no reserved lane) if nothing imported
  // matches it — nothing is ever shown as an empty placeholder row.
  var TIMELINE_CATEGORIES = [
    { key:"character-banner", label:"Character Banners", cls:"character", match:function(e){ return e.category === "character-banner"; } },
    { key:"weapon-banner", label:"Weapon Banners", cls:"weapon", match:function(e){ return e.category === "weapon-banner"; } },
    { key:"chronicled-banner", label:"Chronicled Wish", cls:"chronicled", match:function(e){ return e.category === "chronicled-banner"; } },
    { key:"spiral-abyss", label:"Spiral Abyss", cls:"abyss", match:function(e){ return e.category === "act" && /spiral\s*abyss|abyssal\s*moon\s*spire/i.test(e.name); } },
    { key:"imaginarium-theater", label:"Imaginarium Theater", cls:"theater", match:function(e){ return e.category === "act" && /imaginarium/i.test(e.name); } },
    { key:"stygian-onslaught", label:"Stygian Onslaught", cls:"stygian", match:function(e){ return e.category === "act" && /stygian/i.test(e.name); } },
    { key:"battle-pass", label:"Battle Pass", cls:"battlepass", match:function(e){ return e.category === "act" && /battle\s*pass|gnostic\s*hymn/i.test(e.name); } },
    { key:"events", label:"Events & Challenges", cls:"act", match:function(e){
        return e.category === "act" && !/spiral\s*abyss|abyssal\s*moon\s*spire/i.test(e.name) && !/imaginarium/i.test(e.name) && !/stygian/i.test(e.name) && !/battle\s*pass|gnostic\s*hymn/i.test(e.name);
      } }
  ];
  // HoYoLAB's raw name for this act is "Abyssal Moon Spire" — everyone
  // just calls it Spiral Abyss, so force the friendlier display title
  // instead of showing the literal API name on the bar.
  var TIMELINE_TITLE_OVERRIDE = { "spiral-abyss": "Spiral Abyss" };
  // Hotlinked straight from paimon.moe's own event art (same site we've been
  // pulling other reference images from). pos/zoom match their exact
  // background-position/background-size for these three so the crop looks
  // the same as their timeline.
  var TIMELINE_ART_OVERRIDE = {
    "spiral-abyss": { url:"https://paimon.moe/images/events/spiral_abyss.jpg", pos:"0% 30%", zoom:"100%" },
    "imaginarium-theater": { url:"https://paimon.moe/images/events/Imaginarium%20Theater%20tmp.png", pos:"0% 70%", zoom:"200%" },
    "stygian-onslaught": { url:"https://paimon.moe/images/events/Stygian%20Onslaught.png", pos:"0% 40%", zoom:"200%" }
  };
  var timelineFiltersWired = false;
  var GANTT_DAY_WIDTH = 34;
  var GANTT_ROW_HEIGHT = 26;
  var GANTT_ROW_GAP = 10;
  var GANTT_SECTION_GAP = 10;
  var GANTT_TOP_GAP = 10;

  // Green at pity 1, red at hard pity (90 for Character, 80 for Weapon) —
  // used to color the pity number on 5★ chips so a glance shows how close
  // that particular pull was to the cap.
  function pityColor(pity, cap){
    var ratio = Math.max(0, Math.min(1, (pity - 1) / Math.max(1, cap - 1)));
    var hue = 120 - 120 * ratio;
    return "hsl(" + hue + ", 70%, 55%)";
  }

  function formatTimeLeft(endMs, nowMs){
    var diff = endMs - nowMs;
    if(diff <= 0) return "Ended";
    var totalMinutes = Math.floor(diff / 60000);
    var days = Math.floor(totalMinutes / 1440);
    var hours = Math.floor((totalMinutes % 1440) / 60);
    var minutes = totalMinutes % 60;
    if(days > 0) return days + "d " + hours + "h " + minutes + "m left";
    return hours + "h " + minutes + "m left";
  }
  var ganttNowIntervalId = null;

  // Extracts a representative color from a banner's own icon art and turns
  // it into a bar background, instead of every bar in a category (e.g. every
  // Character Event Wish) always being the same fixed purple. Cached by URL
  // so it's only computed once per icon, ever, even across re-renders.
  var timelineIconColorCache = {};
  function rgbToHsl(r, g, b){
    r/=255; g/=255; b/=255;
    var max=Math.max(r,g,b), min=Math.min(r,g,b);
    var h=0, s=0, l=(max+min)/2;
    if(max !== min){
      var d = max-min;
      s = l > 0.5 ? d/(2-max-min) : d/(max+min);
      if(max===r) h = (g-b)/d + (g<b?6:0);
      else if(max===g) h = (b-r)/d + 2;
      else h = (r-g)/d + 4;
      h /= 6;
    }
    return { h:h, s:s, l:l };
  }
  function hslToRgb(h, s, l){
    function hue2rgb(p, q, t){
      if(t<0) t+=1; if(t>1) t-=1;
      if(t<1/6) return p+(q-p)*6*t;
      if(t<1/2) return q;
      if(t<2/3) return p+(q-p)*(2/3-t)*6;
      return p;
    }
    var r, g, b;
    if(s === 0){ r=g=b=l; }
    else{
      var q = l<0.5 ? l*(1+s) : l+s-l*s;
      var p = 2*l-q;
      r = hue2rgb(p, q, h+1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h-1/3);
    }
    return { r:Math.round(r*255), g:Math.round(g*255), b:Math.round(b*255) };
  }
  // Sampled icon colors tend to come out muted/washed-out (splash art has a
  // lot of soft gradients and skin/sky tones) — forcing full saturation
  // makes the resulting bar color read as an actual vivid color instead of
  // gray-ish, regardless of how saturated the source pixels were. A
  // near-gray average is left alone rather than snapping to an arbitrary
  // vivid hue: a barely-there tint (e.g. rgb(130,128,128)) is essentially
  // sampling noise, not the art's real dominant color, so forcing it to
  // 100% would produce a random-looking pure hue instead of gray.
  function saturateColor(c){
    var hsl = rgbToHsl(c.r, c.g, c.b);
    if(hsl.s > 0.06) hsl.s = 1;
    return hslToRgb(hsl.h, hsl.s, hsl.l);
  }
  function extractImageAverageColor(url, cb){
    if(Object.prototype.hasOwnProperty.call(timelineIconColorCache, url)){
      cb(timelineIconColorCache[url]);
      return;
    }
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function(){
      var result = null;
      try{
        var size = 24;
        var canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        var data = ctx.getImageData(0, 0, size, size).data;
        var r=0, g=0, b=0, count=0;
        for(var i=0; i<data.length; i+=4){
          if(data[i+3] < 100) continue; // skip near-transparent pixels
          r += data[i]; g += data[i+1]; b += data[i+2];
          count++;
        }
        if(count > 0){
          result = saturateColor({ r: Math.round(r/count), g: Math.round(g/count), b: Math.round(b/count) });
        }
      }catch(e){
        // Canvas got tainted — the CDN didn't send CORS headers, so pixel
        // data can't be read. Just fall back to the fixed category color.
        result = null;
      }
      timelineIconColorCache[url] = result;
      cb(result);
    };
    img.onerror = function(){
      timelineIconColorCache[url] = null;
      cb(null);
    };
    img.src = url;
  }
  function colorToGradientCss(c){
    var lighten = function(v){ return Math.min(255, Math.round(v + (255-v)*0.18)); };
    var darken = function(v){ return Math.round(v * 0.5); };
    var light = "rgb(" + lighten(c.r) + "," + lighten(c.g) + "," + lighten(c.b) + ")";
    var dark = "rgb(" + darken(c.r) + "," + darken(c.g) + "," + darken(c.b) + ")";
    return "linear-gradient(100deg, " + light + ", " + dark + ")";
  }

  function timelineSlug(s){
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  }

  // Picks a representative icon for a banner: the first 5★ avatar/weapon in
  // its pool, falling back to the first item of any rarity. Acts have no
  // banner roster, so they get no icon and just show a solid color bar.
  function pickBannerIcon(item){
    var pool = (item.avatars || []).concat(item.weapon || []);
    if(!pool.length) return null;
    var five = pool.find(function(p){ return p.rarity === 5; });
    return (five || pool[0]).icon || null;
  }

  // The featured 5★'s name (e.g. "Mavuika", "Sandrone") — used both as the
  // fallback bar label before a custom title is set, and as the "{title} -
  // {name} Banner" suffix once one is.
  function pickFiveStarName(item){
    var pool = (item.avatars || []).concat(item.weapon || []);
    var five = pool.find(function(p){ return p.rarity === 5; });
    return five ? five.name : null;
  }

  // Turns a raw act_calendar payload (the whole fetch response, or just its
  // .data object) into a flat list of {id, name, category, start, end,
  // iconUrl, fourStarChars, fourStarWeapons} entries. Acts with no real date
  // range (some upcoming acts report start_timestamp/end_timestamp of "0"
  // with a null start_time/end_time) are skipped since there's nothing to
  // draw a bar for yet. fourStarChars/fourStarWeapons record exactly which
  // 4★s were rate-up on that specific banner run, straight from the avatars/
  // weapon rosters HoYoLAB already includes — this is what lets the 4★ Pity
  // guarantee arrow be based on real per-patch rate-up data instead of a
  // guess, the same way the Timeline chart uses this payload for its bars.
  function parseActCalendarPayload(raw){
    var data = (raw && raw.data) ? raw.data : raw;
    if(!data || typeof data !== "object") throw new Error("That doesn't look like the act_calendar response.");

    var entries = [];
    function addList(list, category){
      (list || []).forEach(function(item){
        var startSec = parseInt(item.start_timestamp, 10);
        var endSec = parseInt(item.end_timestamp, 10);
        if(!startSec || !endSec) return;
        var name = item.pool_name || item.name;
        if(!name) return;
        var id = category + "|" + timelineSlug(name) + "|" + startSec;
        var iconUrl = (category === "character-banner") ? pickBannerIcon(item)
          // Best-effort guess at HoYoLAB's field name for an act's own poster
          // art (undocumented API, not confirmed against a real payload) —
          // falls back to no art rather than breaking if none match.
          : (category === "act") ? (item.act_icon || item.icon || item.pic || item.banner_pic || item.pool_pic || item.act_pic || null)
          : null;
        var fiveStarName = (category === "character-banner") ? pickFiveStarName(item) : null;
        var fourStarChars = (item.avatars || []).filter(function(a){ return a.rarity === 4; }).map(function(a){ return a.name; });
        var fourStarWeapons = (item.weapon || []).filter(function(w){ return w.rarity === 4; }).map(function(w){ return w.name; });
        entries.push({
          id:id, name:name, category:category, start:startSec*1000, end:endSec*1000, iconUrl:iconUrl,
          fiveStarName:fiveStarName, fourStarChars:fourStarChars, fourStarWeapons:fourStarWeapons
        });
      });
    }

    addList(data.avatar_card_pool_list, "character-banner");
    addList(data.weapon_card_pool_list, "weapon-banner");
    addList(data.mixed_card_pool_list, "chronicled-banner");
    addList(data.act_list, "act");
    addList(data.fixed_act_list, "act");

    if(!entries.length) throw new Error("No banners or events with a valid date range were found in that JSON.");
    return entries;
  }

  // Merges freshly-parsed entries into the saved timeline, keyed by id, so
  // repeated imports across patches accumulate history instead of
  // overwriting it. An entry that already exists gets its fields refreshed
  // in place (dates/icons are occasionally corrected between snapshots).
  function importTimelineEntries(entries){
    var byId = {};
    timelineEntries.forEach(function(e){ byId[e.id] = e; });
    var added = 0, updated = 0;
    entries.forEach(function(e){
      var existing = byId[e.id];
      if(existing){
        existing.name = e.name; existing.category = e.category; existing.start = e.start; existing.end = e.end;
        existing.iconUrl = e.iconUrl || null;
        existing.fiveStarName = e.fiveStarName || null;
        existing.fourStarChars = e.fourStarChars || [];
        existing.fourStarWeapons = e.fourStarWeapons || [];
        updated++;
      } else {
        byId[e.id] = e;
        timelineEntries.push(e);
        added++;
      }
    });
    saveTimeline();
    return { added:added, updated:updated };
  }

  // Shifts a real UTC epoch ms into "display timezone" ms — either the fixed
  // Asia server offset (UTC+8) or the viewer's own browser-local offset —
  // such that reading the result back out with UTC getters gives the
  // correct wall-clock date/time to show. This lets all the grid math and
  // header-label code stay identical regardless of which mode is active.
  function timelineShiftMs(ms){
    var toggle = document.getElementById("timelineLocalTime");
    var useServer = !toggle || toggle.checked;
    if(useServer) return ms + 8*3600000;
    return ms - (new Date(ms)).getTimezoneOffset()*60000;
  }

  // Greedy interval-graph row packing: entries (sorted by start ascending)
  // go in the first row whose previous entry has already ended, otherwise a
  // new row is opened. Produces the minimum number of rows with no overlaps.
  function packTimelineRows(entries){
    var rows = [];
    entries.forEach(function(e){
      var placed = false;
      for(var i=0;i<rows.length;i++){
        if(rows[i].lastEnd <= e.start){
          rows[i].items.push(e);
          rows[i].lastEnd = e.end;
          placed = true;
          break;
        }
      }
      if(!placed) rows.push({ lastEnd:e.end, items:[e] });
    });
    return rows.map(function(r){ return r.items; });
  }

  function renderTimelineView(){
    document.getElementById("timelineCountCap").textContent = timelineEntries.length ? (" \u00b7 " + timelineEntries.length) : "";

    if(!timelineFiltersWired){
      timelineFiltersWired = true;
      document.getElementById("timelineLocalTime").addEventListener("change", function(){
        renderGanttChart(true);
      });
    }
    renderGanttChart(true);
  }

  function renderGanttChart(shouldAutoScroll){
    var wrap = document.getElementById("ganttWrap");
    var innerEl = document.getElementById("ganttInner");
    var headerMonths = document.getElementById("ganttHeaderMonths");
    var headerDays = document.getElementById("ganttHeaderDays");
    var gridlines = document.getElementById("ganttGridlines");
    var rowsEl = document.getElementById("ganttRows");
    var nowLine = document.getElementById("ganttNowLine");
    var bodyEl = document.getElementById("ganttBody");

    if(ganttNowIntervalId){ clearInterval(ganttNowIntervalId); ganttNowIntervalId = null; }
    wrap.querySelectorAll(".gantt-empty-note").forEach(function(n){ n.remove(); });

    var allEntries = timelineEntries;
    if(!allEntries.length){
      innerEl.style.display = "none";
      var note = document.createElement("div");
      note.className = "gantt-empty-note empty-note";
      note.textContent = "Nothing imported yet \u2014 click Import Calendar above to load banner and event history from HoYoLAB.";
      wrap.appendChild(note);
      return;
    }

    // Sort every imported entry into its fixed lane category, keeping only
    // categories that actually matched something (an empty category never
    // reserves a lane).
    var sections = TIMELINE_CATEGORIES.map(function(sec){
      var entries = allEntries.filter(sec.match).sort(function(a,b){ return a.start - b.start; });
      return { def:sec, entries:entries };
    }).filter(function(s){ return s.entries.length > 0; });

    var visibleSections = sections;
    if(!visibleSections.length){
      innerEl.style.display = "none";
      var note2 = document.createElement("div");
      note2.className = "gantt-empty-note empty-note";
      note2.textContent = "Nothing to show.";
      wrap.appendChild(note2);
      return;
    }
    innerEl.style.display = "";

    var DAY = 86400000;
    var now = Date.now();
    var nowShifted = timelineShiftMs(now);

    var minShifted = Infinity, maxShifted = -Infinity;
    allEntries.forEach(function(e){
      var s = timelineShiftMs(e.start), en = timelineShiftMs(e.end);
      if(s < minShifted) minShifted = s;
      if(en > maxShifted) maxShifted = en;
    });
    minShifted = Math.min(minShifted, nowShifted);
    maxShifted = Math.max(maxShifted, nowShifted);

    var startDayIdx = Math.floor(minShifted/DAY) - 1;
    var endDayIdx = Math.ceil(maxShifted/DAY) + 1;
    var totalDays = Math.max(1, endDayIdx - startDayIdx);
    var totalWidth = totalDays * GANTT_DAY_WIDTH;

    headerDays.style.width = totalWidth + "px";
    headerMonths.style.width = totalWidth + "px";
    gridlines.style.cssText = "position:absolute; top:0; bottom:0; left:0; width:" + totalWidth + "px;";
    rowsEl.style.width = totalWidth + "px";
    bodyEl.style.width = totalWidth + "px";

    var WEEKDAY_LETTERS = ["Su","Mo","Tu","We","Th","Fr","Sa"];
    var MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var dayColsHtml = [], monthsHtml = [], gridlinesHtml = [];
    var lastMonthKey = null;
    var todayDayIdx = Math.floor(nowShifted/DAY);

    for(var i=0;i<totalDays;i++){
      var dayIdx = startDayIdx + i;
      var d = new Date(dayIdx*DAY);
      var y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate(), dow = d.getUTCDay();
      var x = i * GANTT_DAY_WIDTH;
      var isToday = dayIdx === todayDayIdx;
      var isWeekend = (dow === 0 || dow === 6);
      dayColsHtml.push(
        '<div class="gantt-day-col' + (isToday?' today':'') + (isWeekend?' weekend':'') + '" style="left:' + x + 'px; width:' + GANTT_DAY_WIDTH + 'px;">' +
          '<span class="dow">' + WEEKDAY_LETTERS[dow] + '</span><span class="dom">' + da + '</span>' +
        '</div>'
      );
      gridlinesHtml.push('<div class="gantt-gridline" style="left:' + x + 'px;"></div>');
      var monthKey = y + "-" + mo;
      if(monthKey !== lastMonthKey){
        lastMonthKey = monthKey;
        monthsHtml.push('<div class="gantt-header-month" style="left:' + x + 'px;">' + MONTH_NAMES[mo] + (mo === 0 ? " '" + String(y).slice(2) : "") + '</div>');
      }
    }
    headerDays.innerHTML = dayColsHtml.join("");
    headerMonths.innerHTML = monthsHtml.join("");
    gridlines.innerHTML = gridlinesHtml.join("");

    var nowX = (nowShifted/DAY - startDayIdx) * GANTT_DAY_WIDTH;
    nowLine.style.left = nowX + "px";
    nowLine.style.display = "block";
    function updateNowBadge(){
      var d2 = new Date(timelineShiftMs(Date.now()));
      var pad2 = function(n){ return (n < 10 ? "0" : "") + n; };
      document.getElementById("ganttNowBadge").textContent =
        pad2(d2.getUTCHours()) + ":" + pad2(d2.getUTCMinutes()) + ":" + pad2(d2.getUTCSeconds());

      var nowTick = Date.now();
      document.querySelectorAll(".gantt-bar-countdown[data-end]").forEach(function(el){
        var endMs = parseInt(el.getAttribute("data-end"), 10);
        var text = formatTimeLeft(endMs, nowTick);
        el.textContent = text;
        el.classList.toggle("ended", text === "Ended");
      });
    }
    updateNowBadge();
    ganttNowIntervalId = setInterval(updateNowBadge, 1000);

    var rowsHtml = [];
    var iconColorTargets = []; // {id, iconUrl} for every bar with art, to color after render
    var rowTop = GANTT_TOP_GAP;
    var isFirstSection = true;
    visibleSections.forEach(function(section){
      if(!isFirstSection) rowTop += GANTT_SECTION_GAP - GANTT_ROW_GAP;
      isFirstSection = false;

      var rows = packTimelineRows(section.entries);
      rows.forEach(function(items){
        var rowHtml = ['<div class="gantt-row" style="top:' + rowTop + 'px; height:' + GANTT_ROW_HEIGHT + 'px;">'];
        items.forEach(function(e){
          var s = timelineShiftMs(e.start), en = timelineShiftMs(e.end);
          var x = (s/DAY - startDayIdx) * GANTT_DAY_WIDTH;
          var w = Math.max(GANTT_DAY_WIDTH*0.6, (en - s)/DAY * GANTT_DAY_WIDTH);
          var catCls = "cat-" + section.def.cls;
          var artOverride = TIMELINE_ART_OVERRIDE[section.def.key];
          var art = artOverride
            ? '<div class="gantt-bar-art" style="background-image:url(\'' + artOverride.url.replace(/'/g,"") + '\'); background-position:' + artOverride.pos + '; background-size:' + artOverride.zoom + ';"></div>'
            : (e.iconUrl ? '<div class="gantt-bar-art" style="background-image:url(\'' + e.iconUrl.replace(/'/g,"") + '\');background-position: 0% 40%;"></div>' : '');
          var timeLeft = formatTimeLeft(e.end, now);
          var countdownCls = timeLeft === "Ended" ? "gantt-bar-countdown ended" : "gantt-bar-countdown";
          // Auto-title + featured-5★ art are exclusive to the two Character
          // Event Wish bars. Weapon Event Wish always shows a fixed literal
          // title (the banner's real in-game name never changes run to run).
          // Chronicled Wish keeps its plain e.name, untouched by any of this.
          var displayName = e.name;
          if(e.category === "weapon-banner"){
            displayName = "Epitome Invocation - Weapon Banner";
          } else if(e.fiveStarName){
            displayName = e.customTitle ? (e.customTitle + " - " + e.fiveStarName + " Banner") : e.fiveStarName;
          } else if(TIMELINE_TITLE_OVERRIDE[section.def.key]){
            // HoYoLAB's raw name for Spiral Abyss is literally "Abyssal Moon
            // Spire" — show the name everyone actually recognizes instead.
            displayName = TIMELINE_TITLE_OVERRIDE[section.def.key];
          }
          var nativeTitleAttr = e.fiveStarName ? "" : (' title="' + escapeHtml(displayName) + '"');
          var clickableCls = e.fiveStarName ? " clickable" : "";
          if(!artOverride && e.iconUrl) iconColorTargets.push({ id:e.id, iconUrl:e.iconUrl });
          rowHtml.push(
            '<div class="gantt-bar ' + catCls + clickableCls + '" data-id="' + escapeHtml(e.id) + '" style="left:' + x + 'px; width:' + w + 'px; height:' + GANTT_ROW_HEIGHT + 'px;"' + nativeTitleAttr + '>' +
              art +
              '<div class="gantt-bar-label"><span class="gantt-bar-title">' + escapeHtml(displayName) + '</span><span class="' + countdownCls + '" data-end="' + e.end + '">' + timeLeft + '</span></div>' +
            '</div>'
          );
        });
        rowHtml.push('</div>');
        rowsHtml.push(rowHtml.join(""));
        rowTop += GANTT_ROW_HEIGHT + GANTT_ROW_GAP;
      });
    });
    rowsEl.style.height = rowTop + "px";
    bodyEl.style.height = rowTop + "px";
    rowsEl.innerHTML = rowsHtml.join("");
    animateBarsDrawIn(rowsEl.querySelectorAll(".gantt-bar"));

    iconColorTargets.forEach(function(t){
      extractImageAverageColor(t.iconUrl, function(color){
        if(!color) return; // extraction failed — bar keeps its fixed category gradient
        var bar = rowsEl.querySelector('.gantt-bar[data-id="' + t.id.replace(/"/g,'\\"') + '"]');
        if(bar) bar.style.background = colorToGradientCss(color);
      });
    });

    if(shouldAutoScroll){
      var viewportWidth = wrap.clientWidth;
      wrap.scrollLeft = Math.max(0, nowX - viewportWidth/2);
    }
  }

  // Turns vertical mouse-wheel/trackpad scrolling into horizontal scrolling
  // over the Gantt chart, since the chart itself has no vertical overflow —
  // this matches how most horizontal timeline/calendar UIs behave. Eased via
  // GSAP for the same buttery feel as the page-level ScrollSmoother, with the
  // same fallback: if GSAP isn't available or reduced motion is on, it just
  // falls back to an instant scrollLeft jump (previous behavior, unchanged).
  (function(){
    var ganttWrap = document.getElementById("ganttWrap");
    var scrollTarget = null; // null until the first wheel tick establishes a baseline

    ganttWrap.addEventListener("wheel", function(e){
      // If the wheel event is already mostly horizontal (trackpad shift-scroll
      // or a horizontal trackpad swipe), let the browser handle it natively.
      if(Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();

      var max = ganttWrap.scrollWidth - ganttWrap.clientWidth;

      if(!gsapReady()){
        ganttWrap.scrollLeft += e.deltaY;
        return;
      }

      // Base the next target off wherever the eased scroll currently sits
      // (or the live scrollLeft on the very first tick / after a manual drag),
      // so rapid wheel ticks keep compounding smoothly instead of each one
      // restarting from the current (still catching-up) position.
      var base = scrollTarget === null ? ganttWrap.scrollLeft : scrollTarget;
      scrollTarget = Math.max(0, Math.min(max, base + e.deltaY));

      gsap.to(ganttWrap, {
        scrollLeft: scrollTarget,
        duration: 0.6,
        ease: "power3.out",
        overwrite: "auto",
        onComplete: function(){ scrollTarget = null; }
      });
    }, { passive:false });

    // A manual drag/touch scroll should immediately take priority over any
    // in-flight eased wheel tween, and become the new baseline for the next one.
    ganttWrap.addEventListener("pointerdown", function(){
      gsap.killTweensOf(ganttWrap);
      scrollTarget = null;
    });
  })();

  // Hover tooltip (5★ + rate-up 4★s) and click-to-edit-title, delegated on
  // the stable #ganttRows container so re-rendering the chart (which replaces
  // its innerHTML every time) never needs listeners re-bound.
  var bannerTitleEditingId = null;
  (function(){
    var rowsEl = document.getElementById("ganttRows");
    var tooltip = document.getElementById("ganttTooltip");
    var wrap = document.getElementById("ganttWrap");

    function findEntry(bar){
      var id = bar.getAttribute("data-id");
      return timelineEntries.find(function(e){ return e.id === id; });
    }

    rowsEl.addEventListener("mousemove", function(e){
      var bar = e.target.closest(".gantt-bar[data-id]");
      if(!bar){ tooltip.classList.remove("show"); return; }
      var entry = findEntry(bar);
      if(!entry || !entry.fiveStarName){ tooltip.classList.remove("show"); return; }
      var fourStars = (entry.fourStarChars || []).concat(entry.fourStarWeapons || []);
      tooltip.innerHTML =
        '<div class="tt-row"><span class="tt-dot five"></span>5★<b>' + escapeHtml(entry.fiveStarName) + '</b></div>' +
        (fourStars.length ? '<div class="tt-row"><span class="tt-dot four"></span>4★<b>' + escapeHtml(fourStars.join(", ")) + '</b></div>' : "");
      var wrapRect = wrap.getBoundingClientRect();
      tooltip.style.left = (e.clientX - wrapRect.left + wrap.scrollLeft) + "px";
      tooltip.style.top = (e.clientY - wrapRect.top + wrap.scrollTop) + "px";
      tooltip.classList.add("show");
    });
    rowsEl.addEventListener("mouseleave", function(){
      tooltip.classList.remove("show");
    });

    rowsEl.addEventListener("click", function(e){
      var bar = e.target.closest(".gantt-bar[data-id]");
      if(!bar) return;
      var entry = findEntry(bar);
      if(!entry || !entry.fiveStarName) return; // only banners have a title to set — acts open nothing
      bannerTitleEditingId = entry.id;
      document.getElementById("bannerTitleContext").textContent = "Featured 5★: " + entry.fiveStarName;
      document.getElementById("bannerTitleInput").value = entry.customTitle || "";
      updateBannerTitlePreview();
      openModal("bannerTitleOverlay");
      document.getElementById("bannerTitleInput").focus();
    });
  })();

  function updateBannerTitlePreview(){
    var entry = timelineEntries.find(function(e){ return e.id === bannerTitleEditingId; });
    if(!entry) return;
    var val = document.getElementById("bannerTitleInput").value.trim();
    var bannerSuffix = (entry.category === "weapon-banner") ? "Weapon" : entry.fiveStarName;
    var preview = val ? (val + " - " + bannerSuffix + " Banner") : entry.fiveStarName;
    document.getElementById("bannerTitlePreview").textContent = "Bar will show: " + preview;
  }
  document.getElementById("bannerTitleInput").addEventListener("input", updateBannerTitlePreview);

  document.getElementById("saveBannerTitle").addEventListener("click", function(){
    var entry = timelineEntries.find(function(e){ return e.id === bannerTitleEditingId; });
    if(entry){
      var val = document.getElementById("bannerTitleInput").value.trim();
      entry.customTitle = val || null;
      saveTimeline();
      renderGanttChart(false);
    }
    closeModal("bannerTitleOverlay");
  });
  document.getElementById("clearBannerTitle").addEventListener("click", function(){
    var entry = timelineEntries.find(function(e){ return e.id === bannerTitleEditingId; });
    if(entry){
      entry.customTitle = null;
      saveTimeline();
      renderGanttChart(false);
    }
    closeModal("bannerTitleOverlay");
  });

  document.getElementById("openImportCalendar").addEventListener("click", function(){
    document.getElementById("timelineImportLog").className = "log-box";
    document.getElementById("timelineImportLog").innerHTML = "";
    document.getElementById("calendarJsonInput").value = "";
    openModal("timelineImportOverlay");
  });

  document.getElementById("startTimelineImport").addEventListener("click", function(){
    var logEl = document.getElementById("timelineImportLog");
    logEl.className = "log-box show";
    logEl.innerHTML = "";
    function log(kind, msg){
      var line = document.createElement("div");
      line.className = kind;
      line.textContent = msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }

    var raw = document.getElementById("calendarJsonInput").value.trim();
    if(!raw){ log("err", "Paste the act_calendar JSON response first."); return; }

    var parsed;
    try{ parsed = JSON.parse(raw); }
    catch(e){ log("err", "That's not valid JSON \u2014 make sure you copied the full response body."); return; }

    var entries;
    try{ entries = parseActCalendarPayload(parsed); }
    catch(e){ log("err", e.message); return; }

    var result = importTimelineEntries(entries);
    var parts = [];
    if(result.added) parts.push(result.added + " new");
    if(result.updated) parts.push(result.updated + " updated");
    log("ok", "Imported. " + (parts.length ? parts.join(", ") + "." : "Nothing changed \u2014 already up to date."));
    renderTimelineView();
  });

  // Genshin's internal weapon-type codes, as returned by HoYoLAB's
  // character/list endpoint (same codes used for the equipped-weapon's
  // "type" field too).
  var HOYOLAB_WEAPON_TYPE = { 1:"Sword", 10:"Catalyst", 11:"Claymore", 12:"Bow", 13:"Polearm" };

  // Takes the raw character/list payload (the whole fetch response, or just
  // its .data) and syncs charactersList against it: this roster is treated
  // as the source of truth for ownership + constellation level, since it's
  // pulled directly from the account rather than inferred from wish history.
  // Every character in the payload gets owned:true, its real constellation
  // count, and corrected element/rarity/weapon; anyone missing from the
  // payload is marked not-owned; anyone in the payload but missing from
  // charactersList entirely gets added.
  function importCharacterRoster(payload){
    var root = payload && payload.data ? payload.data : payload;
    var list = root && Array.isArray(root.list) ? root.list : null;
    if(!list) throw new Error("That doesn't look like the character/list response.");

    var added = 0, updated = 0;
    var SKIP_NAMES = { "Traveler":true, "Manekin":true, "Manekina":true };
    charactersList = charactersList.filter(function(c){ return !SKIP_NAMES[c.name]; });
    charactersList.forEach(function(c){ c.owned = false; });

    list.forEach(function(item){
      if(!item || !item.name || SKIP_NAMES[item.name]) return; // Traveler + placeholder test entries aren't tracked here
      var weaponStr = HOYOLAB_WEAPON_TYPE[item.weapon_type];
      var constellations = Math.max(0, Math.min(6, item.actived_constellation_num || 0));
      var nameNorm = normalizeName(item.name);
      var existing = charactersList.find(function(c){ return normalizeName(c.name) === nameNorm; });

      if(existing){
        existing.owned = true;
        existing.constellations = constellations;
        if(item.element) existing.element = item.element;
        if(item.rarity) existing.rarity = item.rarity;
        if(weaponStr) existing.weapon = weaponStr;
        updated++;
      } else {
        var id = "c_" + item.name.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_" + Date.now().toString(36) + added;
        charactersList.push({
          id:id, name:item.name, element:item.element || "Pyro", rarity:item.rarity || 4,
          weapon:weaponStr || "Sword", owned:true, constellations:constellations
        });
        added++;
      }
    });

    saveCharacters();
    return { added:added, updated:updated };
  }

  // Strips everything but letters/digits and lowercases, so a GOOD-format
  // key like "KaedeharaKazuha" or "DragonsBane" can be matched against our
  // spaced/punctuated display names ("Kaedehara Kazuha", "Dragon's Bane")
  // without needing a manual key->name translation table.
  function normalizeGoodKey(str){
    return String(str||"").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function importGoodData(payload){
    if(!payload || payload.format !== "GOOD"){
      throw new Error("That doesn't look like a GOOD-format export (missing \"format\":\"GOOD\").");
    }
    var GOOD_SKIP = { traveler:true, manekin:true, manekina:true };
    var charsAdded = 0, charsUpdated = 0, weaponsAdded = 0, weaponsRaised = 0, weaponsUnchanged = 0;

    (payload.characters || []).forEach(function(c){
      if(!c || !c.key) return;
      var norm = normalizeGoodKey(c.key);
      if(GOOD_SKIP[norm]) return;
      var constellations = Math.max(0, Math.min(6, c.constellation || 0));
      var existing = charactersList.find(function(x){ return normalizeGoodKey(x.name) === norm; });
      if(existing){
        existing.owned = true;
        existing.constellations = constellations;
        charsUpdated++;
      } else {
        var dbMatch = DEFAULT_CHARACTER_DB.find(function(d){ return normalizeGoodKey(d.name) === norm; });
        var id = "c_" + norm + "_" + Date.now().toString(36) + charsAdded;
        charactersList.push({
          id:id, name: dbMatch ? dbMatch.name : c.key,
          element: dbMatch ? dbMatch.element : "Pyro", rarity: dbMatch ? dbMatch.rarity : 4,
          weapon: dbMatch ? dbMatch.weapon : "Sword", owned:true, constellations:constellations
        });
        charsAdded++;
      }
    });
    saveCharacters();

    // A weapon's refinement rank is how many total copies have been fed into
    // it, so if the same weapon key shows up more than once in the export
    // (e.g. two separate Dragon's Bane entries), their refinements combine
    // into one "total copies owned" figure for that weapon.
    var refinementTotals = {};
    (payload.weapons || []).forEach(function(w){
      if(!w || !w.key) return;
      var norm = normalizeGoodKey(w.key);
      var r = Math.max(1, w.refinement || 1);
      refinementTotals[norm] = (refinementTotals[norm] || 0) + r;
    });

    var uid = db.activeUid;
    var wishCounts = uid ? computeWeaponPullCounts(uid) : {};

    Object.keys(refinementTotals).forEach(function(norm){
      var goodTotal = refinementTotals[norm];
      var existing = weaponsList.find(function(x){ return normalizeGoodKey(x.name) === norm; });
      if(existing){
        var wishCount = wishCounts[normalizeName(existing.name)] || 0;
        var currentTotal = wishCount + (existing.manualPulls || 0);
        // Merge upward only: wish history is a hard floor on how many copies
        // were ever pulled, so this import can raise the total but never
        // lower it below what's already tracked.
        if(goodTotal > currentTotal){
          existing.manualPulls = goodTotal - wishCount;
          weaponsRaised++;
        } else {
          weaponsUnchanged++;
        }
      } else {
        var dbMatch = DEFAULT_WEAPON_DB.find(function(d){ return normalizeGoodKey(d.name) === norm; });
        if(!dbMatch) return; // unrecognized weapon key, skip rather than guess its type/rarity/ATK
        var id = "w_" + norm + "_" + Date.now().toString(36) + weaponsAdded;
        weaponsList.push({
          id:id, name:dbMatch.name, type:dbMatch.type, rarity:dbMatch.rarity,
          atk:dbMatch.atk, secondary:dbMatch.secondary, manualPulls:goodTotal
        });
        weaponsAdded++;
      }
    });
    saveWeapons();

    return { charsAdded:charsAdded, charsUpdated:charsUpdated, weaponsAdded:weaponsAdded, weaponsRaised:weaponsRaised, weaponsUnchanged:weaponsUnchanged };
  }

  document.getElementById("openImportCharacters").addEventListener("click", function(){
    document.getElementById("characterImportLog").className = "log-box";
    document.getElementById("characterImportLog").innerHTML = "";
    document.getElementById("characterJsonInput").value = "";
    openModal("characterImportOverlay");
  });

  document.getElementById("startCharacterImport").addEventListener("click", function(){
    var logEl = document.getElementById("characterImportLog");
    logEl.className = "log-box show";
    logEl.innerHTML = "";
    function log(kind, msg){
      var line = document.createElement("div");
      line.className = kind;
      line.textContent = msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }

    var raw = document.getElementById("characterJsonInput").value.trim();
    if(!raw){ log("err", "Paste the character/list JSON response first."); return; }

    var parsed;
    try{ parsed = JSON.parse(raw); }
    catch(e){ log("err", "That's not valid JSON \u2014 make sure you copied the full response body."); return; }

    var result;
    try{ result = importCharacterRoster(parsed); }
    catch(e){ log("err", e.message); return; }

    log("ok", "Imported. " + result.updated + " matched, " + result.added + " new character" + (result.added === 1 ? "" : "s") + " added.");
    refreshCharactersView();
  });

  document.getElementById("openImportGood").addEventListener("click", function(){
    document.getElementById("goodImportLog").className = "log-box";
    document.getElementById("goodImportLog").innerHTML = "";
    document.getElementById("goodJsonInput").value = "";
    openModal("goodImportOverlay");
  });

  document.getElementById("startGoodImport").addEventListener("click", function(){
    var logEl = document.getElementById("goodImportLog");
    logEl.className = "log-box show";
    logEl.innerHTML = "";
    function log(kind, msg){
      var line = document.createElement("div");
      line.className = kind;
      line.textContent = msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }

    var raw = document.getElementById("goodJsonInput").value.trim();
    if(!raw){ log("err", "Paste a GOOD-format JSON export first."); return; }

    var parsed;
    try{ parsed = JSON.parse(raw); }
    catch(e){ log("err", "That's not valid JSON \u2014 make sure you copied the whole file."); return; }

    var result;
    try{ result = importGoodData(parsed); }
    catch(e){ log("err", e.message); return; }

    log("ok", "Characters: " + result.charsUpdated + " matched, " + result.charsAdded + " new.");
    log("ok", "Weapons: " + result.weaponsRaised + " had their pull count raised, " + result.weaponsUnchanged + " already at or above this total, " + result.weaponsAdded + " unrecognized weapon key" + (result.weaponsAdded === 1 ? "" : "s") + " added to the catalog.");
    refreshCharactersView();
    refreshWeaponsView();
  });

  /* ---------------------------------------------------------------------
   * Modal wiring
   * ------------------------------------------------------------------- */
  function openModal(id){
    var el = document.getElementById(id);
    if(el._closeTimer){ clearTimeout(el._closeTimer); el._closeTimer = null; }
    el.classList.remove("closing");
    el.classList.add("open");
  }
  function closeModal(id){
    var el = document.getElementById(id);
    if(!el.classList.contains("open") || el.classList.contains("closing")) return;
    if(prefersReducedMotion()){ el.classList.remove("open"); return; }
    el.classList.add("closing");
    el._closeTimer = setTimeout(function(){
      el.classList.remove("open");
      el.classList.remove("closing");
      el._closeTimer = null;
    }, 120);
  }

  document.querySelectorAll("[data-close]").forEach(function(btn){
    btn.addEventListener("click", function(){ closeModal(btn.getAttribute("data-close")); });
  });
  document.querySelectorAll(".overlay").forEach(function(ov){
    ov.addEventListener("click", function(e){ if(e.target === ov) closeModal(ov.id); });
  });

  function openImportOverlay(){
    document.getElementById("importLog").className = "log-box";
    document.getElementById("importLog").innerHTML = "";
    openModal("importOverlay");
  }
  document.getElementById("openImport").addEventListener("click", openImportOverlay);

  document.getElementById("copyPsCommand").addEventListener("click", function(){
    var btn = this;
    var text = document.getElementById("psCommand").value;
    function done(ok){
      btn.innerHTML = ok ? (icon("check") + " Copied") : "Couldn't copy. Select & copy manually";
      setTimeout(function(){ btn.innerHTML = icon("clipboard") + " Copy command"; }, 1800);
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ done(true); }).catch(function(){
        fallbackCopy(text, done);
      });
    } else {
      fallbackCopy(text, done);
    }
  });

  function fallbackCopy(text, cb){
    var ta = document.getElementById("psCommand");
    ta.focus();
    ta.select();
    try{
      var ok = document.execCommand("copy");
      cb(ok);
    }catch(e){
      cb(false);
    }
  }
  document.getElementById("startImport").addEventListener("click", function(){
    runImport(document.getElementById("urlInput").value);
  });

  var stdCharsSelected = new Set();
  var stdWeaponsSelected = new Set();
  var stdCharsSelectedSnapshot = null; // lets the picker modal's Cancel button discard in-progress toggles
  var stdWeaponsSelectedSnapshot = null;

  function renderStdCharsSummary(){
    var div = document.getElementById("stdCharsSummary");
    var picked = charactersList.filter(function(c){ return c.rarity===5 && stdCharsSelected.has(normalizeName(c.name)); })
      .sort(function(a,b){ return a.name.localeCompare(b.name); });
    if(!picked.length){
      div.innerHTML = '<span class="std-summary-empty">No characters selected yet.</span>';
      return;
    }
    div.innerHTML = picked.map(function(c){ return '<span class="std-chip active">' + escapeHtml(c.name) + '</span>'; }).join("");
  }

  function renderStdWeaponsSummary(){
    var div = document.getElementById("stdWeaponsSummary");
    var picked = weaponsList.filter(function(w){ return w.rarity===5 && stdWeaponsSelected.has(normalizeName(w.name)); })
      .sort(function(a,b){ return a.name.localeCompare(b.name); });
    if(!picked.length){
      div.innerHTML = '<span class="std-summary-empty">No weapons selected yet.</span>';
      return;
    }
    div.innerHTML = picked.map(function(w){ return '<span class="std-chip active">' + escapeHtml(w.name) + '</span>'; }).join("");
  }

  /* ---------------------------------------------------------------------
   * Character picker modal — lets you tap-select which 5★ characters count
   * as "standard banner", using the same card grid as the main Characters
   * tab (just re-keyed to selection instead of ownership, locked to 5★
   * only, and with rarity sorting/filtering removed since it's moot here).
   * ------------------------------------------------------------------- */
  var characterPickerElementFilter = { Pyro:true, Hydro:true, Anemo:true, Electro:true, Dendro:true, Cryo:true, Geo:true };
  var characterPickerWeaponFilter = { Sword:true, Claymore:true, Polearm:true, Bow:true, Catalyst:true };
  var characterPickerSort = "element";
  var characterPickerSortAscMap = { name:true, element:true, weapon:true };
  var characterPickerFiltersWired = false;

  function openCharacterPickerModal(){
    stdCharsSelectedSnapshot = new Set(stdCharsSelected);
    document.getElementById("characterPickerSearch").value = "";
    renderCharacterPickerGrid();
    openModal("characterPickerOverlay");
  }
  document.getElementById("openCharacterPicker").addEventListener("click", openCharacterPickerModal);

  document.getElementById("characterPickerSearch").addEventListener("input", renderCharacterPickerGrid);

  document.getElementById("cancelCharacterPicker").addEventListener("click", function(){
    if(stdCharsSelectedSnapshot) stdCharsSelected = stdCharsSelectedSnapshot;
    closeModal("characterPickerOverlay");
  });
  document.getElementById("confirmCharacterPicker").addEventListener("click", function(){
    renderStdCharsSummary();
    closeModal("characterPickerOverlay");
  });

  function renderCharacterPickerGrid(){
    if(!characterPickerFiltersWired){
      characterPickerFiltersWired = true;

      var elDiv = document.getElementById("characterPickerElementFilter");
      elDiv.classList.add("element-pill-row");
      ["Pyro","Hydro","Anemo","Electro","Dendro","Cryo","Geo"].forEach(function(el){
        var meta = ELEMENT_ICONS[el];
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "element-pill-btn active";
        btn.title = el;
        btn.style.background = meta.color;
        btn.style.color = meta.text;
        btn.innerHTML = elementIcon(el);
        btn.addEventListener("click", function(){
          characterPickerElementFilter[el] = !characterPickerElementFilter[el];
          btn.classList.toggle("active", characterPickerElementFilter[el]);
          renderCharacterPickerGrid();
        });
        elDiv.appendChild(btn);
      });

      var wepDiv = document.getElementById("characterPickerWeaponFilter");
      var weaponPillRow = document.createElement("div");
      weaponPillRow.className = "weapon-pill-row";
      ["Sword","Claymore","Polearm","Bow","Catalyst"].forEach(function(w){
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "weapon-pill-btn active";
        btn.title = w;
        btn.innerHTML = weaponIconMask(w, "#ffffff", 18);
        btn.addEventListener("click", function(){
          characterPickerWeaponFilter[w] = !characterPickerWeaponFilter[w];
          btn.classList.toggle("active", characterPickerWeaponFilter[w]);
          renderCharacterPickerGrid();
        });
        weaponPillRow.appendChild(btn);
      });
      wepDiv.appendChild(weaponPillRow);

      document.getElementById("characterPickerSortBtn").addEventListener("click", function(e){
        e.stopPropagation();
        document.getElementById("characterPickerSortDropdown").classList.toggle("open");
      });
      document.querySelectorAll("#characterPickerSortPanel .sort-option").forEach(function(btn){
        btn.addEventListener("click", function(){
          var newSort = btn.getAttribute("data-sort");
          document.getElementById("characterPickerSortDropdown").classList.remove("open");
          if(newSort === characterPickerSort) return;
          characterPickerSort = newSort;
          document.getElementById("characterPickerSortLabel").textContent = SORT_LABELS[characterPickerSort];
          document.querySelectorAll("#characterPickerSortPanel .sort-option").forEach(function(b){ b.classList.toggle("active", b===btn); });
          renderCharacterPickerGrid();
        });
      });
      document.addEventListener("click", function(){
        document.getElementById("characterPickerSortDropdown").classList.remove("open");
      });
      document.getElementById("characterPickerSortDirBtn").addEventListener("click", function(){
        characterPickerSortAscMap[characterPickerSort] = !characterPickerSortAscMap[characterPickerSort];
        renderCharacterPickerGrid();
      });
    }

    var term = document.getElementById("characterPickerSearch").value.trim().toLowerCase();
    var rows = charactersList.filter(function(c){
      if(c.rarity !== 5) return false; // this list is 5★-only, so no rarity filter/sort is needed at all
      if(!characterPickerElementFilter[c.element]) return false;
      if(!characterPickerWeaponFilter[c.weapon]) return false;
      if(term && c.name.toLowerCase().indexOf(term) === -1) return false;
      return true;
    });

    rows.sort(function(a,b){
      var cmp = 0;
      if(characterPickerSort === "name") cmp = a.name.localeCompare(b.name);
      else if(characterPickerSort === "element"){
        cmp = a.element.localeCompare(b.element);
        if(cmp !== 0) return characterPickerSortAscMap[characterPickerSort] ? cmp : -cmp;
        return a.name.localeCompare(b.name);
      } else if(characterPickerSort === "weapon"){
        cmp = a.weapon.localeCompare(b.weapon);
        if(cmp !== 0) return characterPickerSortAscMap[characterPickerSort] ? cmp : -cmp;
        return a.name.localeCompare(b.name);
      }
      return characterPickerSortAscMap[characterPickerSort] ? cmp : -cmp;
    });
    var dirBtn = document.getElementById("characterPickerSortDirBtn");
    if(dirBtn) dirBtn.classList.toggle("desc", !characterPickerSortAscMap[characterPickerSort]);

    var grid = document.getElementById("characterPickerGrid");
    var total5 = charactersList.filter(function(c){ return c.rarity===5; }).length;
    document.getElementById("characterPickerCountCap").textContent = " \u00b7 " + rows.length + " of " + total5;

    if(rows.length === 0){
      grid.innerHTML = '<div class="empty-note" style="grid-column:1/-1; padding:20px; text-align:center;">' +
        (total5 ? "No characters match the current filters." : "No 5★ characters in your Characters list yet.") + '</div>';
      return;
    }

    var lastGroupElement = null, lastGroupWeapon = null;
    grid.innerHTML = rows.map(function(c){
      var groupHeader = "";
      if(characterPickerSort === "element" && c.element !== lastGroupElement){
        lastGroupElement = c.element;
        var groupMeta = ELEMENT_ICONS[c.element];
        groupHeader = '<div class="character-group-header"><span class="element-badge lg" style="' + (groupMeta ? ("background:"+groupMeta.color+";color:"+groupMeta.text+";") : "") + '">' + (groupMeta ? elementIcon(c.element) : icon("gem")) + '</span>' + escapeHtml(c.element) + '</div>';
      } else if(characterPickerSort === "weapon" && c.weapon !== lastGroupWeapon){
        lastGroupWeapon = c.weapon;
        groupHeader = '<div class="character-group-header"><span class="element-badge lg">' + weaponIconMask(c.weapon, "currentColor", 16) + '</span>' + escapeHtml(c.weapon) + '</div>';
      }
      var selected = stdCharsSelected.has(normalizeName(c.name));
      var elMeta = ELEMENT_ICONS[c.element];
      var infoStyle = elMeta ? ("background:"+elMeta.color+";color:"+elMeta.text+";") : "";
      var imgUrl = characterImageUrl(c.name);
      return groupHeader + '<div class="character-card rarity-5'+(selected?'':' greyed-out')+'" data-name="'+escapeHtml(c.name)+'">' +
        '<div class="character-portrait-wrap">' +
          '<img class="character-portrait" data-cache-src="'+escapeHtml(imgUrl)+'" alt="">' +
          '<div class="character-top-badges">' +
            '<div class="character-info-pill" title="'+escapeHtml(c.element)+'"><span style="color:'+(elMeta?elMeta.color:'inherit')+';display:flex;">'+(elMeta ? elementIcon(c.element) : icon("gem"))+'</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="character-info" style="'+infoStyle+'">' +
          '<div class="character-info-text"><div class="character-name-row"><span class="character-name">'+escapeHtml(c.name)+'</span>'+weaponIconMask(c.weapon, elMeta ? elMeta.text : "#ffffff", 22)+'</div></div>' +
        '</div>' +
      '</div>';
    }).join("");

    grid.querySelectorAll(".character-card").forEach(function(cardEl){
      cardEl.addEventListener("click", function(){
        var key = normalizeName(cardEl.getAttribute("data-name"));
        if(stdCharsSelected.has(key)) stdCharsSelected.delete(key); else stdCharsSelected.add(key);
        cardEl.classList.toggle("greyed-out", !stdCharsSelected.has(key));
      });
    });
  }

  /* ---------------------------------------------------------------------
   * Weapon picker modal — same pattern as the character picker above:
   * tap-select which 5★ weapons count as "standard banner", 5★-only,
   * filterable by weapon type, sortable by name or type.
   * ------------------------------------------------------------------- */
  var weaponPickerTypeFilter = { Sword:true, Claymore:true, Polearm:true, Bow:true, Catalyst:true };
  var weaponPickerSort = "type";
  var weaponPickerSortAscMap = { name:true, type:true };
  var weaponPickerFiltersWired = false;

  function openWeaponPickerModal(){
    stdWeaponsSelectedSnapshot = new Set(stdWeaponsSelected);
    document.getElementById("weaponPickerSearch").value = "";
    renderWeaponPickerGrid();
    openModal("weaponPickerOverlay");
  }
  document.getElementById("openWeaponPicker").addEventListener("click", openWeaponPickerModal);

  document.getElementById("weaponPickerSearch").addEventListener("input", renderWeaponPickerGrid);

  document.getElementById("cancelWeaponPicker").addEventListener("click", function(){
    if(stdWeaponsSelectedSnapshot) stdWeaponsSelected = stdWeaponsSelectedSnapshot;
    closeModal("weaponPickerOverlay");
  });
  document.getElementById("confirmWeaponPicker").addEventListener("click", function(){
    renderStdWeaponsSummary();
    closeModal("weaponPickerOverlay");
  });

  function renderWeaponPickerGrid(){
    if(!weaponPickerFiltersWired){
      weaponPickerFiltersWired = true;

      var typeDiv = document.getElementById("weaponPickerTypeFilter");
      var weaponPillRow = document.createElement("div");
      weaponPillRow.className = "weapon-pill-row";
      ["Sword","Claymore","Polearm","Bow","Catalyst"].forEach(function(w){
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "weapon-pill-btn active";
        btn.title = w;
        btn.innerHTML = weaponIconMask(w, "#ffffff", 18);
        btn.addEventListener("click", function(){
          weaponPickerTypeFilter[w] = !weaponPickerTypeFilter[w];
          btn.classList.toggle("active", weaponPickerTypeFilter[w]);
          renderWeaponPickerGrid();
        });
        weaponPillRow.appendChild(btn);
      });
      typeDiv.appendChild(weaponPillRow);

      document.getElementById("weaponPickerSortBtn").addEventListener("click", function(e){
        e.stopPropagation();
        document.getElementById("weaponPickerSortDropdown").classList.toggle("open");
      });
      document.querySelectorAll("#weaponPickerSortPanel .sort-option").forEach(function(btn){
        btn.addEventListener("click", function(){
          var newSort = btn.getAttribute("data-sort");
          document.getElementById("weaponPickerSortDropdown").classList.remove("open");
          if(newSort === weaponPickerSort) return;
          weaponPickerSort = newSort;
          document.getElementById("weaponPickerSortLabel").textContent = weaponPickerSort === "name" ? "Name" : "Type";
          document.querySelectorAll("#weaponPickerSortPanel .sort-option").forEach(function(b){ b.classList.toggle("active", b===btn); });
          renderWeaponPickerGrid();
        });
      });
      document.addEventListener("click", function(){
        document.getElementById("weaponPickerSortDropdown").classList.remove("open");
      });
      document.getElementById("weaponPickerSortDirBtn").addEventListener("click", function(){
        weaponPickerSortAscMap[weaponPickerSort] = !weaponPickerSortAscMap[weaponPickerSort];
        renderWeaponPickerGrid();
      });
    }

    var term = document.getElementById("weaponPickerSearch").value.trim().toLowerCase();
    var rows = weaponsList.filter(function(w){
      if(w.rarity !== 5) return false; // this list is 5★-only, so no rarity filter/sort is needed at all
      if(!weaponPickerTypeFilter[w.type]) return false;
      if(term && w.name.toLowerCase().indexOf(term) === -1) return false;
      return true;
    });

    rows.sort(function(a,b){
      var cmp = 0;
      if(weaponPickerSort === "name") cmp = a.name.localeCompare(b.name);
      else if(weaponPickerSort === "type"){
        cmp = a.type.localeCompare(b.type);
        if(cmp !== 0) return weaponPickerSortAscMap[weaponPickerSort] ? cmp : -cmp;
        return a.name.localeCompare(b.name);
      }
      return weaponPickerSortAscMap[weaponPickerSort] ? cmp : -cmp;
    });
    var dirBtn = document.getElementById("weaponPickerSortDirBtn");
    if(dirBtn) dirBtn.classList.toggle("desc", !weaponPickerSortAscMap[weaponPickerSort]);

    var grid = document.getElementById("weaponPickerGrid");
    var total5 = weaponsList.filter(function(w){ return w.rarity===5; }).length;
    document.getElementById("weaponPickerCountCap").textContent = " \u00b7 " + rows.length + " of " + total5;

    if(rows.length === 0){
      grid.innerHTML = '<div class="empty-note" style="grid-column:1/-1; padding:20px; text-align:center;">' +
        (total5 ? "No weapons match the current filters." : "No 5★ weapons in your Weapons list yet.") + '</div>';
      return;
    }

    var lastGroupType = null;
    grid.innerHTML = rows.map(function(w){
      var groupHeader = "";
      if(weaponPickerSort === "type" && w.type !== lastGroupType){
        lastGroupType = w.type;
        groupHeader = '<div class="character-group-header"><span class="element-badge lg">' + weaponIconMask(w.type, "currentColor", 16) + '</span>' + escapeHtml(w.type) + '</div>';
      }
      var selected = stdWeaponsSelected.has(normalizeName(w.name));
      var imgUrl = weaponImageUrl(w.name);
      return groupHeader + '<div class="weapon-card rarity-5'+(selected?'':' greyed-out')+'" data-name="'+escapeHtml(w.name)+'">' +
        '<div class="weapon-portrait-wrap">' +
          '<img class="weapon-portrait" data-cache-src="'+escapeHtml(imgUrl)+'" alt="">' +
        '</div>' +
        '<div class="weapon-info">' +
          '<div class="weapon-name-row"><span class="weapon-name">'+escapeHtml(w.name)+'</span>'+weaponIconMask(w.type, "#ffffff", 22)+'</div>' +
        '</div>' +
      '</div>';
    }).join("");

    grid.querySelectorAll(".weapon-card").forEach(function(cardEl){
      cardEl.addEventListener("click", function(){
        var key = normalizeName(cardEl.getAttribute("data-name"));
        if(stdWeaponsSelected.has(key)) stdWeaponsSelected.delete(key); else stdWeaponsSelected.add(key);
        cardEl.classList.toggle("greyed-out", !stdWeaponsSelected.has(key));
      });
    });
  }

  function renderSettingsView(){
    stdCharsSelected = new Set(settings.standardCharacters.map(normalizeName));
    stdWeaponsSelected = new Set(settings.standardWeapons.map(normalizeName));
    renderStdCharsSummary();
    renderStdWeaponsSummary();
    document.getElementById("pityBufferInput").value = settings.pityBuffer;
    renderAccountList();
  }
  document.getElementById("saveSettings").addEventListener("click", function(){
    settings.standardCharacters = charactersList.filter(function(c){ return c.rarity===5 && stdCharsSelected.has(normalizeName(c.name)); }).map(function(c){ return c.name; });
    settings.standardWeapons = weaponsList.filter(function(w){ return w.rarity===5 && stdWeaponsSelected.has(normalizeName(w.name)); }).map(function(w){ return w.name; });
    var pb = parseInt(document.getElementById("pityBufferInput").value, 10);
    settings.pityBuffer = (!isNaN(pb) && pb >= 0) ? Math.min(pb, 89) : 0;
    saveSettings();
    renderAll();
    var btn = document.getElementById("saveSettings");
    var original = btn.textContent;
    btn.textContent = "Saved!";
    setTimeout(function(){ btn.textContent = original; }, 1500);
  });

  document.getElementById("exportData").addEventListener("click", function(){
    var blob = new Blob([JSON.stringify({ data:db, settings:settings, characters:charactersList, weapons:weaponsList, timeline:timelineEntries }, null, 2)], { type:"application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "wish-counter-backup.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // Generic clipboard copy: Clipboard API where available, with a hidden
  // off-screen textarea + execCommand fallback for non-secure contexts
  // (e.g. plain http://, or older browsers) where navigator.clipboard is
  // unavailable. Distinct from fallbackCopy() above, which is wired to the
  // specific always-present #psCommand textarea; this one works for any
  // arbitrary string, including the full backup JSON.
  function copyToClipboard(text, cb){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ cb(true); }).catch(function(){
        legacyCopyToClipboard(text, cb);
      });
    } else {
      legacyCopyToClipboard(text, cb);
    }
  }
  function legacyCopyToClipboard(text, cb){
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try{ ok = document.execCommand("copy"); }catch(e){ ok = false; }
    document.body.removeChild(ta);
    cb(ok);
  }
  document.getElementById("copyExportData").addEventListener("click", function(){
    var btn = this;
    var original = btn.innerHTML;
    var json = JSON.stringify({ data:db, settings:settings, characters:charactersList, weapons:weaponsList, timeline:timelineEntries }, null, 2);
    copyToClipboard(json, function(ok){
      btn.innerHTML = ok ? (icon("check") + " Copied to clipboard") : (icon("clipboard") + " Couldn't copy, try Export instead");
      setTimeout(function(){ btn.innerHTML = original; }, 1800);
    });
  });
  // Shared by both restore paths (file upload and pasted JSON) below.
  // Mirrors the old importFile change handler's logic exactly, just pulled
  // out so both entry points can reuse it and report through the modal's
  // log-box instead of alert().
  function restoreFromParsedBackup(parsed, log){
    if(parsed.data){
      db = parsed.data;
      if(parsed.settings) settings = parsed.settings;
      if(parsed.characters) charactersList = parsed.characters;
      if(parsed.weapons) weaponsList = parsed.weapons;
      if(parsed.timeline) timelineEntries = parsed.timeline;
      saveData(); saveSettings(); saveCharacters(); saveWeapons(); saveTimeline();
      renderAll();
      log("ok", "Backup restored.");
      return true;
    }
    var converted = convertPaimonExport(parsed);
    var uids = Object.keys(converted);
    if(uids.length === 0){
      log("err", "Couldn't recognize this JSON's format.");
      return false;
    }
    uids.forEach(function(uid){
      if(db.accounts[uid]){
        Object.keys(converted[uid].pulls).forEach(function(gt){
          var existing = db.accounts[uid].pulls[gt] || [];
          var result = mergePullsByContent(existing, converted[uid].pulls[gt]);
          result.merged.sort(sortByTimeThenId);
          db.accounts[uid].pulls[gt] = result.merged;
        });
      } else {
        db.accounts[uid] = converted[uid];
        Object.keys(db.accounts[uid].pulls).forEach(function(gt){
          db.accounts[uid].pulls[gt].sort(sortByTimeThenId);
        });
      }
    });
    db.activeUid = uids[0];
    saveData();
    renderAll();
    log("ok", "Imported " + uids.length + " account(s) from a paimon.moe-style backup.");
    log("warn", "Rarity for pulls is inferred from pull patterns (pity resets) rather than read directly, since that file format doesn't store it explicitly. Reliable for older pulls, but could occasionally misjudge a brand-new 5\u2605 not yet in this app's known-name list.");
    return true;
  }

  function resetRestoreModal(){
    document.getElementById("restoreLog").className = "log-box";
    document.getElementById("restoreLog").innerHTML = "";
    document.getElementById("restoreJsonInput").value = "";
    document.getElementById("restoreFileInput").value = "";
    var fn = document.getElementById("restoreFilename");
    fn.className = "dropzone-filename";
    fn.textContent = "";
  }

  document.getElementById("importData").addEventListener("click", function(){
    resetRestoreModal();
    openModal("restoreOverlay");
  });

  var restoreDropzone = document.getElementById("restoreDropzone");
  var restoreFileInput = document.getElementById("restoreFileInput");

  restoreDropzone.addEventListener("click", function(){ restoreFileInput.click(); });
  restoreDropzone.addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); restoreFileInput.click(); }
  });
  ["dragenter","dragover"].forEach(function(evt){
    restoreDropzone.addEventListener(evt, function(e){
      e.preventDefault(); e.stopPropagation();
      restoreDropzone.classList.add("dragover");
    });
  });
  ["dragleave","dragend"].forEach(function(evt){
    restoreDropzone.addEventListener(evt, function(e){
      e.preventDefault(); e.stopPropagation();
      restoreDropzone.classList.remove("dragover");
    });
  });
  restoreDropzone.addEventListener("drop", function(e){
    e.preventDefault(); e.stopPropagation();
    restoreDropzone.classList.remove("dragover");
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if(file) handleRestoreFile(file);
  });
  restoreFileInput.addEventListener("change", function(e){
    var file = e.target.files[0];
    if(file) handleRestoreFile(file);
  });

  function handleRestoreFile(file){
    var logEl = document.getElementById("restoreLog");
    logEl.className = "log-box show";
    logEl.innerHTML = "";
    function log(kind, msg){
      var line = document.createElement("div");
      line.className = kind;
      line.textContent = msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }
    var fn = document.getElementById("restoreFilename");
    fn.className = "dropzone-filename show";
    fn.innerHTML = icon("clipboard") + " " + file.name;

    var reader = new FileReader();
    reader.onload = function(){
      var parsed;
      try{ parsed = JSON.parse(reader.result); }
      catch(err){ log("err", "Couldn't read that file: " + err.message); return; }
      restoreFromParsedBackup(parsed, log);
    };
    reader.onerror = function(){ log("err", "Couldn't read that file."); };
    reader.readAsText(file);
  }

  document.getElementById("startRestore").addEventListener("click", function(){
    var logEl = document.getElementById("restoreLog");
    logEl.className = "log-box show";
    logEl.innerHTML = "";
    function log(kind, msg){
      var line = document.createElement("div");
      line.className = kind;
      line.textContent = msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }
    var raw = document.getElementById("restoreJsonInput").value.trim();
    if(!raw){ log("err", "Paste a backup JSON first, or use the upload area above."); return; }
    var parsed;
    try{ parsed = JSON.parse(raw); }
    catch(err){ log("err", "That's not valid JSON \u2014 make sure you pasted the whole thing."); return; }
    restoreFromParsedBackup(parsed, log);
  });


  document.getElementById("accountSelect").addEventListener("change", function(e){
    db.activeUid = e.target.value;
    saveData();
    populateCharactersFromPulls(db.activeUid);
    renderAll();
  });

  /* ---------------------------------------------------------------------
   * Init
   * ------------------------------------------------------------------- */
  buildStarField();
  migrateCharacterOwnership(db.activeUid);
  if(db.activeUid) populateCharactersFromPulls(db.activeUid);
  renderAll();

  /* Characters view code */
  var editingCharacterId = null;
  var modalElement = "Pyro", modalWeapon = "Sword", modalRarity = 5, modalConstellations = null;

  function renderElementPicker(){
    var div = document.getElementById("characterElementPicker");
    div.innerHTML = "";
    ["Pyro","Hydro","Anemo","Electro","Dendro","Cryo","Geo"].forEach(function(el){
      var meta = ELEMENT_ICONS[el];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "modal-picker-btn" + (modalElement === el ? " active" : "");
      btn.title = el;
      btn.style.background = meta.color;
      btn.style.color = meta.text;
      btn.innerHTML = elementIcon(el);
      btn.addEventListener("click", function(){
        modalElement = el;
        renderElementPicker();
      });
      div.appendChild(btn);
    });
  }

  function renderWeaponPicker(){
    var div = document.getElementById("characterWeaponPicker");
    div.innerHTML = "";
    ["Sword","Claymore","Polearm","Bow","Catalyst"].forEach(function(w){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "modal-weapon-picker-btn" + (modalWeapon === w ? " active" : "");
      btn.title = w;
      btn.innerHTML = weaponIconMask(w, "#ffffff", 27);
      btn.addEventListener("click", function(){
        modalWeapon = w;
        renderWeaponPicker();
      });
      div.appendChild(btn);
    });
  }

  function renderRarityPicker(){
    var div = document.getElementById("characterRarityPicker");
    div.innerHTML = "";
    [5,4].forEach(function(r){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "icon-filter-btn star " + (r === 5 ? "five" : "four") + (modalRarity === r ? " active" : "");
      btn.title = r + "-Star";
      btn.innerHTML = icon("star");
      btn.addEventListener("click", function(){
        modalRarity = r;
        renderRarityPicker();
      });
      div.appendChild(btn);
    });
  }

  function renderConstellationControl(){
    var valueEl = document.getElementById("constellationValue");
    var minusBtn = document.getElementById("constellationMinus");
    var plusBtn = document.getElementById("constellationPlus");
    if(modalConstellations === null){
      valueEl.style.display = "none";
      minusBtn.disabled = true;
    } else {
      valueEl.style.display = "";
      valueEl.textContent = "C" + modalConstellations;
      valueEl.classList.toggle("c6", modalConstellations === 6);
      minusBtn.disabled = false;
    }
    plusBtn.disabled = (modalConstellations === 6);
  }
  document.getElementById("constellationPlus").addEventListener("click", function(){
    modalConstellations = modalConstellations === null ? 0 : Math.min(6, modalConstellations + 1);
    renderConstellationControl();
  });
  document.getElementById("constellationMinus").addEventListener("click", function(){
    if(modalConstellations === null) return;
    modalConstellations = modalConstellations === 0 ? null : modalConstellations - 1;
    renderConstellationControl();
  });

  function openCharacterModal(id){
    editingCharacterId = id || null;
    var c = editingCharacterId ? charactersList.find(function(x){ return x.id === editingCharacterId; }) : null;
    document.getElementById("characterModalTitle").textContent = c ? "Edit Character" : "Add Character";
    document.getElementById("characterName").value = c ? c.name : "";
    modalElement = c ? c.element : "Pyro";
    modalWeapon = c ? c.weapon : "Sword";
    modalRarity = c ? c.rarity : 5;
    modalConstellations = (c && c.owned) ? c.constellations : null;
    renderElementPicker();
    renderWeaponPicker();
    renderRarityPicker();
    renderConstellationControl();
    document.getElementById("deleteCharacter").style.display = c ? "inline-flex" : "none";
    openModal("characterOverlay");
  }
  document.getElementById("openAddCharacter").addEventListener("click", function(){ openCharacterModal(null); });
  document.getElementById("saveCharacter").addEventListener("click", function(){
    var name = document.getElementById("characterName").value.trim();
    var element = modalElement;
    var weapon = modalWeapon;
    var rarity = modalRarity;
    var owned = modalConstellations !== null;
    var constellations = owned ? modalConstellations : 0;
    if(!name){ alert("Give the character a name."); return; }
    if(editingCharacterId){
      var c = charactersList.find(function(x){ return x.id === editingCharacterId; });
      if(c){ c.name = name; c.element = element; c.weapon = weapon; c.rarity = rarity; c.constellations = constellations; c.owned = owned; }
    } else {
      var id = "c_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_" + Date.now().toString(36);
      charactersList.push({ id:id, name:name, element:element, weapon:weapon, rarity:rarity, constellations:constellations, owned:owned });
    }
    saveCharacters();
    closeModal("characterOverlay");
    refreshCharactersView();
  });
  document.getElementById("deleteCharacter").addEventListener("click", function(){
    if(!editingCharacterId) return;
    if(!confirm("Remove this character from the roster?")) return;
    charactersList = charactersList.filter(function(x){ return x.id !== editingCharacterId; });
    saveCharacters();
    closeModal("characterOverlay");
    refreshCharactersView();
  });
  function renderCharactersView(){
    var elementsFilterDiv = document.getElementById("elementsFilter");
    if(elementsFilterDiv && elementsFilterDiv.innerHTML === ""){
      elementsFilterDiv.classList.add("element-pill-row");
      ["Pyro","Hydro","Anemo","Electro","Dendro","Cryo","Geo"].forEach(function(el){
        var meta = ELEMENT_ICONS[el];
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "element-pill-btn active";
        btn.title = el;
        btn.style.background = meta.color;
        btn.style.color = meta.text;
        btn.innerHTML = elementIcon(el);
        btn.addEventListener("click", function(){
          charactersElementFilter[el] = !charactersElementFilter[el];
          btn.classList.toggle("active", charactersElementFilter[el]);
          refreshCharactersView();
        });
        elementsFilterDiv.appendChild(btn);
      });
    }
    var weaponsTypeFilterDiv = document.getElementById("weaponsTypeFilter");
    if(weaponsTypeFilterDiv && weaponsTypeFilterDiv.innerHTML === ""){
      var weaponPillRow = document.createElement("div");
      weaponPillRow.className = "weapon-pill-row";
      ["Sword","Claymore","Polearm","Bow","Catalyst"].forEach(function(w){
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "weapon-pill-btn active";
        btn.title = w;
        btn.innerHTML = weaponIconMask(w, "#ffffff", 18);
        btn.addEventListener("click", function(){
          charactersWeaponFilter[w] = !charactersWeaponFilter[w];
          btn.classList.toggle("active", charactersWeaponFilter[w]);
          refreshCharactersView();
        });
        weaponPillRow.appendChild(btn);
      });
      weaponsTypeFilterDiv.appendChild(weaponPillRow);
    }
    var rarityCharFilterDiv = document.getElementById("rarityCharFilter");
    if(rarityCharFilterDiv && rarityCharFilterDiv.innerHTML === ""){
      [5,4].forEach(function(r){
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "icon-filter-btn star " + (r === 5 ? "five" : "four") + " active";
        btn.title = r + "-Star";
        btn.innerHTML = icon("star");
        btn.addEventListener("click", function(){
          charactersRarityFilter[r] = !charactersRarityFilter[r];
          btn.classList.toggle("active", charactersRarityFilter[r]);
          refreshCharactersView();
        });
        rarityCharFilterDiv.appendChild(btn);
      });
    }
    var rows = charactersList.slice();
    var term = charactersSearchTerm.trim().toLowerCase();
    rows = rows.filter(function(r){
      if(!charactersRarityFilter[r.rarity]) return false;
      if(!charactersElementFilter[r.element]) return false;
      if(!charactersWeaponFilter[r.weapon]) return false;
      if(term && r.name.toLowerCase().indexOf(term) === -1) return false;
      return true;
    });
    rows.sort(function(a,b){
      var cmp = 0;
      if(charactersSort === "name") cmp = a.name.localeCompare(b.name);
      else if(charactersSort === "element"){
        cmp = a.element.localeCompare(b.element);
        if(cmp !== 0) return charactersSortAscMap[charactersSort] ? cmp : -cmp;
        return a.name.localeCompare(b.name); // always A-Z within a group, regardless of sort direction
      }
      else if(charactersSort === "rarity"){
        cmp = a.rarity - b.rarity;
        if(cmp !== 0) return charactersSortAscMap[charactersSort] ? cmp : -cmp;
        // Within a rarity tier: owned characters always come first (regardless
        // of sort direction), then A-Z by name within owned/unowned each.
        var ownedCmp = (b.owned?1:0) - (a.owned?1:0);
        if(ownedCmp !== 0) return ownedCmp;
        return a.name.localeCompare(b.name);
      }
      else if(charactersSort === "weapon"){
        cmp = a.weapon.localeCompare(b.weapon);
        if(cmp !== 0) return charactersSortAscMap[charactersSort] ? cmp : -cmp;
        return a.name.localeCompare(b.name); // always A-Z within a group, regardless of sort direction
      }
      else if(charactersSort === "constellations"){
        // Owned characters always outrank unowned ones, even at C0 — otherwise
        // an owned C0 character ties with an unowned character (both read as
        // constellations:0) and ordering between them becomes arbitrary.
        var rankA = a.owned ? (a.constellations + 1) : 0;
        var rankB = b.owned ? (b.constellations + 1) : 0;
        cmp = rankA - rankB;
      }
      return charactersSortAscMap[charactersSort] ? cmp : -cmp;
    });
    var dirBtn = document.getElementById("charactersSortDirBtn");
    if(dirBtn) dirBtn.classList.toggle("desc", !charactersSortAscMap[charactersSort]);
    var grid = document.getElementById("charactersGrid");
    flipGridRebuild(grid, function(){
      if(rows.length === 0){
        grid.innerHTML = '<div class="empty-note" style="grid-column:1/-1; padding:20px; text-align:center;">No characters match the current filters.</div>';
      } else {
        var lastGroupElement = null;
        var lastGroupWeapon = null;
        grid.innerHTML = rows.map(function(c){
          var groupHeader = "";
          if(charactersSort === "element" && c.element !== lastGroupElement){
            lastGroupElement = c.element;
            var groupMeta = ELEMENT_ICONS[c.element];
            var groupIconHtml = groupMeta ? elementIcon(c.element) : icon("gem");
            groupHeader = '<div class="character-group-header" data-flip-id="char-hdr-el-'+escapeHtml(c.element)+'"><span class="element-badge lg" style="' + (groupMeta ? ("background:"+groupMeta.color+";color:"+groupMeta.text+";") : "") + '">' + groupIconHtml + '</span>' + escapeHtml(c.element) + '</div>';
          } else if(charactersSort === "weapon" && c.weapon !== lastGroupWeapon){
            lastGroupWeapon = c.weapon;
            groupHeader = '<div class="character-group-header" data-flip-id="char-hdr-wep-'+escapeHtml(c.weapon)+'"><span class="element-badge lg">' + weaponIconMask(c.weapon, "currentColor", 16) + '</span>' + escapeHtml(c.weapon) + '</div>';
          }
          var has = !!c.owned;
          var elMeta = ELEMENT_ICONS[c.element];
          var infoStyle = elMeta ? ("background:"+elMeta.color+";color:"+elMeta.text+";") : "";
          var imgUrl = characterImageUrl(c.name);
          return groupHeader + '<div class="character-card rarity-'+c.rarity+(has?'':" greyed-out")+'" data-id="'+escapeHtml(c.id)+'" data-flip-id="char-'+escapeHtml(c.id)+'">' +
            '<div class="character-portrait-wrap">' +
              '<img class="character-portrait" data-cache-src="'+escapeHtml(imgUrl)+'" alt="">' +
              '<div class="character-top-badges">' +
                '<div class="character-info-pill" title="'+escapeHtml(c.element)+'"><span style="color:'+(elMeta?elMeta.color:'inherit')+';display:flex;">'+(elMeta ? elementIcon(c.element) : icon("gem"))+'</span>'+(has ? '<span'+(c.constellations===6?' class="c6"':'')+'>C'+c.constellations+'</span>' : '')+'</div>' +
              '</div>' +
              '<div class="character-card-actions"><button class="character-action-btn" data-edit="'+escapeHtml(c.id)+'">'+icon("pencil")+'</button></div>' +
            '</div>' +
            '<div class="character-info" style="'+infoStyle+'">' +
              '<div class="character-info-text"><div class="character-name-row"><span class="character-name">'+escapeHtml(c.name)+'</span>'+weaponIconMask(c.weapon, elMeta ? elMeta.text : "#ffffff", 22)+'</div></div>' +
            '</div>' +
          '</div>';
        }).join("");
      }
    }, { animateCardHeight: true });
    grid.querySelectorAll(".character-action-btn[data-edit]").forEach(function(btn){
      btn.addEventListener("click", function(e){ e.stopPropagation(); openCharacterModal(btn.getAttribute("data-edit")); });
    });
    document.getElementById("charactersCountCap").textContent = rows.length + " of " + charactersList.length;
  }
  var SORT_LABELS = { name:"Name", element:"Element", rarity:"Rarity", weapon:"Weapon", constellations:"Constellations" };
  var charactersSortAscMap = { name:true, element:true, weapon:true, rarity:false, constellations:false };
  document.getElementById("charactersSortBtn").addEventListener("click", function(e){
    e.stopPropagation();
    document.getElementById("charactersSortDropdown").classList.toggle("open");
  });
  document.querySelectorAll("#charactersSortPanel .sort-option").forEach(function(btn){
    btn.addEventListener("click", function(){
      var newSort = btn.getAttribute("data-sort");
      document.getElementById("charactersSortDropdown").classList.remove("open");
      if(newSort === charactersSort) return;
      charactersSort = newSort;
      document.getElementById("charactersSortLabel").textContent = SORT_LABELS[charactersSort];
      document.querySelectorAll("#charactersSortPanel .sort-option").forEach(function(b){ b.classList.toggle("active", b===btn); });
      refreshCharactersView();
    });
  });
  document.addEventListener("click", function(e){
    var dd = document.getElementById("charactersSortDropdown");
    if(dd && dd.classList.contains("open") && !dd.contains(e.target)){
      dd.classList.remove("open");
    }
  });
  document.getElementById("charactersSortDirBtn").addEventListener("click", function(){
    charactersSortAscMap[charactersSort] = !charactersSortAscMap[charactersSort];
    refreshCharactersView();
  });
  document.getElementById("charactersSearch").addEventListener("input", function(e){
    charactersSearchTerm = e.target.value;
    refreshCharactersView();
  });

  document.getElementById("charactersFilterToggle").addEventListener("click", function(){
    var bar = document.querySelector(".characters-filterbar");
    var isOpen = bar.classList.toggle("open");
    this.classList.toggle("active", isOpen);
  });

})();
