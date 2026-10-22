(function () {
  // Time-of-day mascot (brand guide section 2): day from local civil dawn to civil dusk (sun 6 degrees below
  // the horizon), dusk otherwise. The visitor's time zone picks a representative city; nothing leaves the
  // browser. Unknown zone: dusk from 19:00 to 06:30 local. ?sky=day|dusk forces a look, for testing only.
  var Z = {
    America:
      "New_York 40.7 -74;Chicago 41.9 -87.6;Denver 39.7 -105;Phoenix 33.4 -112.1;Los_Angeles 34.1 -118.2;Anchorage 61.2 -149.9;Detroit 42.3 -83;Indiana/Indianapolis 39.8 -86.2;Kentucky/Louisville 38.3 -85.8;Boise 43.6 -116.2;Toronto 43.7 -79.4;Montreal 45.5 -73.6;Vancouver 49.3 -123.1;Edmonton 53.5 -113.5;Winnipeg 49.9 -97.1;Regina 50.4 -104.6;Halifax 44.6 -63.6;St_Johns 47.6 -52.7;Mexico_City 19.4 -99.1;Monterrey 25.7 -100.3;Tijuana 32.5 -117;Cancun 21.2 -86.8;Guatemala 14.6 -90.5;El_Salvador 13.7 -89.2;Tegucigalpa 14.1 -87.2;Managua 12.1 -86.3;Costa_Rica 9.9 -84.1;Panama 9 -79.5;Havana 23.1 -82.4;Santo_Domingo 18.5 -69.9;Port-au-Prince 18.5 -72.3;Jamaica 18 -76.8;Puerto_Rico 18.5 -66.1;Bogota 4.7 -74.1;Caracas 10.5 -66.9;Lima -12 -77;Guayaquil -2.2 -79.9;La_Paz -16.5 -68.1;Santiago -33.4 -70.7;Argentina/Buenos_Aires -34.6 -58.4;Buenos_Aires -34.6 -58.4;Argentina/Cordoba -31.4 -64.2;Montevideo -34.9 -56.2;Asuncion -25.3 -57.6;Sao_Paulo -23.5 -46.6;Bahia -13 -38.5;Fortaleza -3.7 -38.5;Recife -8.1 -34.9;Manaus -3.1 -60;Belem -1.5 -48.5",
    Europe:
      "London 51.5 -0.1;Dublin 53.3 -6.3;Lisbon 38.7 -9.1;Madrid 40.4 -3.7;Paris 48.9 2.4;Brussels 50.8 4.4;Amsterdam 52.4 4.9;Luxembourg 49.6 6.1;Berlin 52.5 13.4;Zurich 47.4 8.5;Vienna 48.2 16.4;Rome 41.9 12.5;Malta 35.9 14.5;Copenhagen 55.7 12.6;Oslo 59.9 10.8;Stockholm 59.3 18.1;Helsinki 60.2 24.9;Warsaw 52.2 21;Prague 50.1 14.4;Budapest 47.5 19;Bratislava 48.1 17.1;Ljubljana 46.1 14.5;Zagreb 45.8 16;Belgrade 44.8 20.5;Sarajevo 43.9 18.4;Skopje 42 21.4;Tirane 41.3 19.8;Sofia 42.7 23.3;Bucharest 44.4 26.1;Chisinau 47 28.9;Athens 38 23.7;Istanbul 41 29;Kyiv 50.5 30.5;Kiev 50.5 30.5;Minsk 53.9 27.6;Vilnius 54.7 25.3;Riga 56.9 24.1;Tallinn 59.4 24.8;Moscow 55.8 37.6;Samara 53.2 50.1;Volgograd 48.7 44.5",
    Africa:
      "Cairo 30 31.2;Lagos 6.5 3.4;Johannesburg -26.2 28;Nairobi -1.3 36.8;Addis_Ababa 9 38.7;Casablanca 33.6 -7.6;Algiers 36.8 3.1;Tunis 36.8 10.2;Tripoli 32.9 13.2;Khartoum 15.6 32.5;Accra 5.6 -0.2;Abidjan 5.3 -4;Dakar 14.7 -17.4;Kinshasa -4.3 15.3;Lubumbashi -11.7 27.5;Luanda -8.8 13.2;Dar_es_Salaam -6.8 39.3;Kampala 0.3 32.6;Maputo -26 32.6;Harare -17.8 31;Lusaka -15.4 28.3;Douala 4.1 9.7;Bamako 12.6 -8;Ouagadougou 12.4 -1.5;Niamey 13.5 2.1;Ndjamena 12.1 15;Mogadishu 2 45.3;Kigali -1.9 30.1;Conakry 9.6 -13.6;Windhoek -22.6 17.1",
    Asia: "Kolkata 23 78;Calcutta 23 78;Shanghai 32 116;Chongqing 29.6 106.5;Urumqi 43.8 87.6;Hong_Kong 22.3 114.2;Macau 22.2 113.5;Taipei 25 121.5;Tokyo 35.7 139.7;Seoul 37.6 127;Pyongyang 39 125.8;Manila 14.6 121;Jakarta -6.2 106.8;Makassar -5.1 119.4;Jayapura -2.5 140.7;Singapore 1.3 103.8;Kuala_Lumpur 3.1 101.7;Bangkok 13.8 100.5;Ho_Chi_Minh 10.8 106.7;Saigon 10.8 106.7;Phnom_Penh 11.6 104.9;Vientiane 18 102.6;Yangon 16.8 96.2;Rangoon 16.8 96.2;Dhaka 23.8 90.4;Kathmandu 27.7 85.3;Katmandu 27.7 85.3;Thimphu 27.5 89.6;Colombo 6.9 79.9;Karachi 28 70;Kabul 34.5 69.2;Tehran 35.7 51.4;Baghdad 33.3 44.4;Riyadh 24.7 46.7;Dubai 25.2 55.3;Muscat 23.6 58.4;Qatar 25.3 51.5;Bahrain 26.2 50.6;Kuwait 29.4 48;Aden 12.8 45;Amman 31.9 35.9;Damascus 33.5 36.3;Beirut 33.9 35.5;Jerusalem 31.8 35.2;Tel_Aviv 32.1 34.8;Gaza 31.5 34.5;Hebron 31.5 35.1;Baku 40.4 49.9;Tbilisi 41.7 44.8;Yerevan 40.2 44.5;Tashkent 41.3 69.3;Almaty 43.2 76.9;Bishkek 42.9 74.6;Dushanbe 38.6 68.8;Ashgabat 37.9 58.4;Ulaanbaatar 47.9 106.9;Yekaterinburg 56.8 60.6;Omsk 55 73.4;Novosibirsk 55 82.9;Krasnoyarsk 56 92.9;Irkutsk 52.3 104.3;Vladivostok 43.1 131.9",
    Australia:
      "Melbourne -37.8 145;Sydney -33.9 151.2;Canberra -35.3 149.1;ACT -35.3 149.1;Brisbane -27.5 153;Adelaide -34.9 138.6;Perth -32 115.9;Hobart -42.9 147.3;Darwin -12.5 130.8",
    Pacific:
      "Auckland -36.8 174.8;Honolulu 21.3 -157.9;Fiji -18.1 178.4;Port_Moresby -9.4 147.2;Guam 13.5 144.8;Noumea -22.3 166.5;Tongatapu -21.1 -175.2;Apia -13.8 -171.8",
    Arctic: "Longyearbyen 78.2 15.6",
    Atlantic: "Reykjavik 64.1 -21.9;Canary 28.1 -15.4",
    Indian: "Antananarivo -18.9 47.5;Mauritius -20.2 57.5",
  };
  var R = Math.PI / 180,
    doc = document.documentElement;
  function where() {
    try {
      var t = Intl.DateTimeFormat().resolvedOptions().timeZone || "",
        i = t.indexOf("/"),
        s = Z[t.slice(0, i)] || "",
        n = t.slice(i + 1) + " ",
        k = (";" + s).indexOf(";" + n);
      if (i < 1 || k < 0) return null;
      var p = s
        .slice(k + n.length)
        .split(";")[0]
        .split(" ");
      return [+p[0], +p[1]];
    } catch (e) {
      return null;
    }
  }
  function sky(now) {
    var q = /[?&]sky=(day|dusk)\b/.exec(location.search);
    if (q) return q[1];
    var c = where(),
      d = new Date(now);
    if (!c) {
      var m = d.getHours() * 60 + d.getMinutes();
      return m >= 1140 || m < 390 ? "dusk" : "day";
    }
    // NOAA-style sunrise equation for the visitor's local calendar date, with the sun at -6 degrees.
    var n = Math.round(
        Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12) / 864e5 +
          2440587.5 -
          2451545 +
          0.0008,
      ),
      j = n - c[1] / 360,
      M = (357.5291 + 0.98560028 * j) % 360,
      C = 1.9148 * Math.sin(M * R) + 0.02 * Math.sin(2 * M * R) + 0.0003 * Math.sin(3 * M * R),
      L = (M + C + 282.9372) % 360,
      T = 2451545 + j + 0.0053 * Math.sin(M * R) - 0.0069 * Math.sin(2 * L * R),
      sd = Math.sin(L * R) * Math.sin(23.4397 * R),
      w =
        (Math.sin(-6 * R) - Math.sin(c[0] * R) * sd) /
        (Math.cos(c[0] * R) * Math.sqrt(1 - sd * sd));
    if (w <= -1) return "day";
    if (w >= 1) return "dusk";
    w = Math.acos(w) / R / 360;
    var dawn = (T - w - 2440587.5) * 864e5,
      dusk = (T + w - 2440587.5) * 864e5;
    return now >= dawn && now < dusk ? "day" : "dusk";
  }
  function apply() {
    var s = sky(Date.now());
    if (doc.getAttribute("data-sky") !== s) {
      doc.setAttribute("data-sky", s);
      var f = document.getElementById("favicon-svg");
      if (f) f.setAttribute("href", "/assets/brand/favicon-" + s + ".svg");
    }
  }
  apply();
  setInterval(apply, 3e5);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) apply();
  });
})();
