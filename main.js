/*
  WORKER: RESULTADOS - CLUB BOWLING PIN OCHO
  CONEXIÓN YA CONFIGURADA:
  Usa el mismo Apps Script que el Histórico de partidas.
  Formato principal admitido:
  { correcto: true, series: [...] }
  También admite:
  1) { correcto: true, partidas: [...] }
  2) { correcto: true, datos: [...] }
  3) { correcto: true, registros: [...] }
  4) Un array directo: [...]
  La clave técnica de cada publicación es:
  Fecha + Competición
  Jornada/Torneo y Fase se muestran como marcas internas.
*/
const API_DATOS =
  "https://script.google.com/macros/s/AKfycbyLjpqERcUAw3IIiPmK6sK-2owuxUCrl8TPcW5egDNGfZ8RaaRUFRKiTG1ha6qt9ug/exec";
const ICS_URL =
  "https://calendar.google.com/calendar/ical/949423f596d10e0bc332a4179aac323b41bcdc688b131af7b3245d673b6b76d3%40group.calendar.google.com/public/basic.ics";
const DIAS_RECIENTES = 30;
const resultsHandler = {
  async fetch(request) {
    try {
      const [respuesta, eventosCalendario] = await Promise.all([
        fetch(API_DATOS, {
          headers: {
            "accept": "application/json"
          }
        }),
        obtenerEventosCalendario()
      ]);
      if (!respuesta.ok) {
        throw new Error(
          "No se han podido obtener los datos de partidas."
        );
      }
      const respuestaApi = await respuesta.json();
      const partidas = extraerPartidas(respuestaApi);
      const resultadosTorneos =
        Array.isArray(respuestaApi?.resultadosTorneos)
          ? respuestaApi.resultadosTorneos
          : [];
      const cronicasResultados =
        Array.isArray(respuestaApi?.cronicasResultados)
          ? respuestaApi.cronicasResultados
          : [];
      const actasLigaIA =
        Array.isArray(respuestaApi?.actasLigaIA)
          ? respuestaApi.actasLigaIA
          : [];
      if (!Array.isArray(partidas)) {
        throw new Error(
          "La respuesta de la API no contiene un listado válido de partidas."
        );
      }
      const jornadas = construirJornadas(partidas, actasLigaIA);
      const torneosFinalizados =
        construirTorneosFinalizados(
          eventosCalendario,
          jornadas
        );
      const html = construirPagina(
        jornadas,
        torneosFinalizados,
        resultadosTorneos,
        cronicasResultados
      );
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "cache-control": "no-store"
        }
      });
    } catch (error) {
      return new Response(
        construirPaginaError(error.message),
        {
          status: 500,
          headers: {
            "content-type": "text/html; charset=UTF-8",
            "cache-control": "no-store"
          }
        }
      );
    }
  }
};
async function obtenerEventosCalendario() {
  try {
    const respuesta = await fetch(ICS_URL, {
      headers: {
        "accept": "text/calendar,text/plain;q=0.9,*/*;q=0.8"
      }
    });
    if (!respuesta.ok) {
      return [];
    }
    const ics = await respuesta.text();
    return parsearEventosIcs(ics);
  } catch (error) {
    // El calendario es una mejora auxiliar. Si falla,
    // Resultados sigue funcionando exactamente como antes.
    return [];
  }
}
function parsearEventosIcs(textoIcs) {
  const texto = String(textoIcs || "")
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "");
  const bloques =
    texto.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  return bloques
    .map(bloque => {
      const summary =
        obtenerValorIcs(bloque, "SUMMARY");
      const dtstart =
        obtenerLineaIcs(bloque, "DTSTART");
      const dtend =
        obtenerLineaIcs(bloque, "DTEND");
      const status =
        obtenerValorIcs(bloque, "STATUS");
      if (
        !summary ||
        !dtstart ||
        String(status).toUpperCase() === "CANCELLED"
      ) {
        return null;
      }
      const inicio =
        interpretarFechaIcs(dtstart.valor);
      const finBruto =
        interpretarFechaIcs(
          dtend?.valor || dtstart.valor
        );
      if (!inicio || !finBruto) {
        return null;
      }
      const todoElDia =
        /^\d{8}$/.test(dtstart.valor);
      let fechaInicio = inicio.fechaIso;
      let fechaFin = finBruto.fechaIso;
      let fechaFinMs = finBruto.ms;
      if (todoElDia && dtend) {
        const finExclusivo =
          new Date(finBruto.ms);
        finExclusivo.setUTCDate(
          finExclusivo.getUTCDate() - 1
        );
        fechaFin = fechaIsoUtc(finExclusivo);
      }
      if (!dtend) {
        fechaFinMs = todoElDia
          ? finDelDiaUtc(inicio.ms)
          : inicio.ms;
      }
      return {
        titulo: desescaparIcs(summary),
        fechaInicio,
        fechaFin,
        todoElDia,
        finRealMs: todoElDia
          ? inicioDiaPosteriorUtc(fechaFin)
          : fechaFinMs
      };
    })
    .filter(Boolean);
}
function obtenerLineaIcs(bloque, propiedad) {
  const expresion = new RegExp(
    "^" + propiedad + "(?:;[^:]*)?:(.*)$",
    "mi"
  );
  const coincidencia = bloque.match(expresion);
  if (!coincidencia) {
    return null;
  }
  return {
    valor: String(coincidencia[1] || "").trim()
  };
}
function obtenerValorIcs(bloque, propiedad) {
  return obtenerLineaIcs(bloque, propiedad)?.valor || "";
}
function interpretarFechaIcs(valor) {
  const texto = String(valor || "").trim();
  const fechaSimple =
    texto.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (fechaSimple) {
    const fecha = new Date(Date.UTC(
      Number(fechaSimple[1]),
      Number(fechaSimple[2]) - 1,
      Number(fechaSimple[3])
    ));
    return {
      ms: fecha.getTime(),
      fechaIso: fechaIsoUtc(fecha)
    };
  }
  const fechaHora =
    texto.match(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/
    );
  if (!fechaHora) {
    return null;
  }
  const fecha = new Date(Date.UTC(
    Number(fechaHora[1]),
    Number(fechaHora[2]) - 1,
    Number(fechaHora[3]),
    Number(fechaHora[4]),
    Number(fechaHora[5]),
    Number(fechaHora[6] || 0)
  ));
  return {
    ms: fecha.getTime(),
    fechaIso: fechaIsoUtc(fecha)
  };
}
function fechaIsoUtc(fecha) {
  return [
    fecha.getUTCFullYear(),
    String(fecha.getUTCMonth() + 1).padStart(2, "0"),
    String(fecha.getUTCDate()).padStart(2, "0")
  ].join("-");
}
function finDelDiaUtc(ms) {
  return ms + 24 * 60 * 60 * 1000;
}
function inicioDiaPosteriorUtc(fechaIso) {
  const partes = String(fechaIso).split("-");
  return Date.UTC(
    Number(partes[0]),
    Number(partes[1]) - 1,
    Number(partes[2]) + 1
  );
}
function desescaparIcs(texto) {
  return String(texto || "")
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}
function normalizarNombreTorneo(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\btemp(?:orada)?\s*\d{2,4}\s*[-/]\s*\d{2,4}\b/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\bmasters\b/g, "master")
    .replace(/\bcto\b/g, "campeonato")
    .replace(/\bcamp\b/g, "campeonato")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function palabrasNombreTorneo(texto) {
  const ignoradas = new Set([
    "de", "del", "la", "las", "el", "los",
    "y", "en", "temp", "temporada"
  ]);
  return normalizarNombreTorneo(texto)
    .split(" ")
    .filter(palabra =>
      palabra.length >= 3 &&
      !ignoradas.has(palabra) &&
      !/^\d+$/.test(palabra)
    );
}
function puntuarSimilitudTorneo(a, b) {
  const na = normalizarNombreTorneo(a);
  const nb = normalizarNombreTorneo(b);
  if (!na || !nb) {
    return 0;
  }
  if (na === nb) {
    return 1000;
  }
  if (
    na.length >= 3 &&
    nb.length >= 3 &&
    (na.includes(nb) || nb.includes(na))
  ) {
    return 850;
  }
  const palabrasA = [...new Set(palabrasNombreTorneo(a))];
  const palabrasB = [...new Set(palabrasNombreTorneo(b))];
  if (!palabrasA.length || !palabrasB.length) {
    return 0;
  }
  const conjuntoB = new Set(palabrasB);
  const comunes = palabrasA.filter(p => conjuntoB.has(p));
  let puntuacion = comunes.length * 120;
  if (comunes.length) {
    const base = Math.min(palabrasA.length, palabrasB.length);
    puntuacion += (comunes.length / base) * 100;
  }
  // También premiamos coincidencias parciales razonables entre palabras
  // (por ejemplo, variantes muy próximas de un mismo nombre).
  for (const pa of palabrasA) {
    for (const pb of palabrasB) {
      if (
        pa !== pb &&
        pa.length >= 5 &&
        pb.length >= 5 &&
        (pa.includes(pb) || pb.includes(pa))
      ) {
        puntuacion += 35;
      }
    }
  }
  return puntuacion;
}
function fechaHoyMadrid() {
  const partes = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).formatToParts(new Date());
  const mapa = Object.fromEntries(
    partes.map(parte => [parte.type, parte.value])
  );
  return [
    mapa.year,
    mapa.month,
    mapa.day
  ].join("-");
}
function construirTorneosFinalizados(
  eventosCalendario,
  jornadas
) {
  const ahora = Date.now();
  const hoyMadrid = fechaHoyMadrid();
  /*
    EMPAREJAMIENTO DE TORNEOS FINALIZADOS
    1) Si los resultados traen EVENTO CALENDARIO, ese campo manda.
       Se compara con el título real de Google Calendar.
    2) La fecha sigue siendo una comprobación de seguridad: las jornadas
       deben caer dentro del intervalo del evento.
    3) Para históricos sin EVENTO CALENDARIO se conserva el sistema
       anterior: fecha primero y similitud del nombre después.
  */
  const eventosFinalizados = eventosCalendario.filter(evento => {
    if (!evento) {
      return false;
    }
    return evento.todoElDia
      ? hoyMadrid > evento.fechaFin
      : evento.finRealMs <= ahora;
  });
  const resultados = [];
  const vistos = new Set();
  const eventosUsados = new Set();
  const jornadasUsadas = new Set();
  function agregarResultado(evento, jornadasCoincidentes, indiceEvento) {
    if (!jornadasCoincidentes.length) return false;
    const porCompeticion = new Map();
    for (const jornada of jornadasCoincidentes) {
      const clave = [
        jornada.temporada,
        jornada.competicion
      ].join("||");
      if (!porCompeticion.has(clave)) {
        porCompeticion.set(clave, {
          temporada: jornada.temporada,
          competicion: jornada.competicion,
          jornadas: []
        });
      }
      porCompeticion.get(clave).jornadas.push(jornada);
    }
    const grupos = [...porCompeticion.values()];
    if (!grupos.length) return false;
    // Con EVENTO CALENDARIO normalmente solo habrá una competición.
    // Si hubiese varias, escogemos la de mayor cobertura de jornadas.
    grupos.sort((a, b) =>
      b.jornadas.length - a.jornadas.length ||
      puntuarSimilitudTorneo(evento.titulo, b.competicion) -
        puntuarSimilitudTorneo(evento.titulo, a.competicion) ||
      compararTexto(a.competicion, b.competicion)
    );
    const candidata = grupos[0];
    const claveJornadas = candidata.jornadas
      .map(jornada => jornada.id)
      .sort()
      .join("||");
    if (jornadasUsadas.has(claveJornadas)) {
      return false;
    }
    const clave = [
      candidata.temporada,
      candidata.competicion,
      evento.fechaInicio,
      evento.fechaFin
    ].join("||");
    if (vistos.has(clave)) {
      return false;
    }
    vistos.add(clave);
    eventosUsados.add(indiceEvento);
    jornadasUsadas.add(claveJornadas);
    resultados.push({
      id: crearId("torneo-final||" + clave),
      tituloCalendario: evento.titulo,
      competicion: candidata.competicion,
      temporada: candidata.temporada,
      fechaInicio: evento.fechaInicio,
      fechaFin: evento.fechaFin
    });
    return true;
  }
  // =====================================================
  // PASO 1 · COINCIDENCIA EXACTA POR EVENTO CALENDARIO
  // =====================================================
  eventosFinalizados.forEach((evento, indiceEvento) => {
    const tituloNormalizado = normalizarNombreTorneo(evento.titulo);
    const exactas = jornadas.filter(jornada => {
      if (
        jornada.fechaIso < evento.fechaInicio ||
        jornada.fechaIso > evento.fechaFin
      ) {
        return false;
      }
      const nombres = Array.isArray(jornada.eventosCalendario)
        ? jornada.eventosCalendario
        : [jornada.eventoCalendario];
      return nombres.some(nombre =>
        nombre &&
        normalizarNombreTorneo(nombre) === tituloNormalizado
      );
    });
    agregarResultado(evento, exactas, indiceEvento);
  });
  // =====================================================
  // PASO 2 · RESPALDO PARA HISTÓRICOS SIN EVENTO CALENDARIO
  // =====================================================
  const propuestas = [];
  eventosFinalizados.forEach((evento, indiceEvento) => {
    if (eventosUsados.has(indiceEvento)) {
      return;
    }
    const porCompeticion = new Map();
    for (const jornada of jornadas) {
      if (
        jornada.fechaIso < evento.fechaInicio ||
        jornada.fechaIso > evento.fechaFin
      ) {
        continue;
      }
      // Si esta jornada ya tiene EVENTO CALENDARIO pero no coincide con
      // este evento, no permitimos que la heurística la reasigne.
      if (jornada.eventoCalendario) {
        continue;
      }
      const claveCompeticion = [
        jornada.temporada,
        jornada.competicion
      ].join("||");
      if (!porCompeticion.has(claveCompeticion)) {
        porCompeticion.set(claveCompeticion, {
          temporada: jornada.temporada,
          competicion: jornada.competicion,
          jornadas: []
        });
      }
      porCompeticion
        .get(claveCompeticion)
        .jornadas
        .push(jornada);
    }
    const candidatas = [...porCompeticion.values()];
    for (const candidata of candidatas) {
      const puntuacionNombre = puntuarSimilitudTorneo(
        evento.titulo,
        candidata.competicion
      );
      const fechasResultados = candidata.jornadas
        .map(jornada => jornada.fechaIso)
        .sort();
      const primeraFecha = fechasResultados[0] || "";
      const ultimaFecha = fechasResultados.at(-1) || "";
      const ajusteFechas =
        (primeraFecha === evento.fechaInicio ? 20 : 0) +
        (ultimaFecha === evento.fechaFin ? 20 : 0) +
        candidata.jornadas.length;
      const claveJornadas = candidata.jornadas
        .map(jornada => jornada.id)
        .sort()
        .join("||");
      propuestas.push({
        indiceEvento,
        evento,
        candidata,
        puntuacionNombre,
        ajusteFechas,
        unicaPorFecha: candidatas.length === 1,
        claveJornadas
      });
    }
  });
  propuestas.sort((a, b) =>
    b.puntuacionNombre - a.puntuacionNombre ||
    b.ajusteFechas - a.ajusteFechas ||
    compararTexto(
      a.candidata.competicion,
      b.candidata.competicion
    )
  );
  const seleccionadas = [];
  for (const propuesta of propuestas) {
    if (propuesta.puntuacionNombre <= 0) {
      continue;
    }
    if (
      eventosUsados.has(propuesta.indiceEvento) ||
      jornadasUsadas.has(propuesta.claveJornadas)
    ) {
      continue;
    }
    eventosUsados.add(propuesta.indiceEvento);
    jornadasUsadas.add(propuesta.claveJornadas);
    seleccionadas.push(propuesta);
  }
  // Si por fecha solo existe una competición histórica posible,
  // seguimos admitiendo la asociación directa como último respaldo.
  for (const propuesta of propuestas) {
    if (!propuesta.unicaPorFecha) {
      continue;
    }
    if (
      eventosUsados.has(propuesta.indiceEvento) ||
      jornadasUsadas.has(propuesta.claveJornadas)
    ) {
      continue;
    }
    eventosUsados.add(propuesta.indiceEvento);
    jornadasUsadas.add(propuesta.claveJornadas);
    seleccionadas.push(propuesta);
  }
  for (const propuesta of seleccionadas) {
    const { evento, candidata } = propuesta;
    const clave = [
      candidata.temporada,
      candidata.competicion,
      evento.fechaInicio,
      evento.fechaFin
    ].join("||");
    if (vistos.has(clave)) {
      continue;
    }
    vistos.add(clave);
    resultados.push({
      id: crearId("torneo-final||" + clave),
      tituloCalendario: evento.titulo,
      competicion: candidata.competicion,
      temporada: candidata.temporada,
      fechaInicio: evento.fechaInicio,
      fechaFin: evento.fechaFin
    });
  }
  return resultados.sort((a, b) =>
    String(b.fechaFin).localeCompare(String(a.fechaFin)) ||
    compararTexto(a.competicion, b.competicion)
  );
}
function extraerPartidas(respuestaApi) {
  if (Array.isArray(respuestaApi)) {
    return respuestaApi;
  }
  if (!respuestaApi || typeof respuestaApi !== "object") {
    return null;
  }
  // El Apps Script del Histórico devuelve datos.series.
  // Cada serie contiene las partidas de un jugador en una jornada.
  if (Array.isArray(respuestaApi.series)) {
    return respuestaApi.series.flatMap(serie => {
      const partidasSerie =
        Array.isArray(serie.partidas)
          ? serie.partidas
          : [];
      return partidasSerie.map(partida => ({
        Fecha: serie.fecha,
        TEMPORADA: serie.temporada,
        JUGADOR: serie.jugador,
        Competicion: serie.competicion,
        "EVENTO CALENDARIO": serie.eventoCalendario || "",
        "Torneo/Jornada": serie.jornada,
        Fase: serie.fase,
        Bolera: serie.bolera,
        NUM_PARTIDA: partida.numero,
        PUNTUACION: partida.puntuacion,
        ALIAS: serie.alias || "",
        URL_FOTO: serie.urlFoto || serie.foto || ""
      }));
    });
  }
  const candidatos = [
    respuestaApi.partidas,
    respuestaApi.datos,
    respuestaApi.registros,
    respuestaApi.resultados,
    respuestaApi.filas
  ];
  return candidatos.find(Array.isArray) || null;
}
function construirJornadasBase(partidasOriginales) {
  const partidas = partidasOriginales
    .map(normalizarPartida)
    .filter(partida =>
      partida.fechaValida &&
      partida.jugador &&
      Number.isFinite(partida.puntuacion)
    );
  const mediasTemporada = calcularMediasTemporada(partidas);
  const mapa = new Map();
  for (const partida of partidas) {
    /*
      Una publicación de Resultados corresponde a una competición
      disputada en una fecha concreta.
      Jornada y Fase se conservan como marcas internas del evento,
      pero no separan a los jugadores en informes distintos.
    */
    const clave = [
      partida.fechaIso,
      partida.competicion
    ].join("||");
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        id: crearId(clave),
        fechaIso: partida.fechaIso,
        fechaMs: partida.fechaMs,
        temporada: partida.temporada,
        competicion: partida.competicion,
        eventosCalendarioSet: new Set(),
        jornadasSet: new Set(),
        fasesSet: new Set(),
        bolerasSet: new Set(),
        partidas: []
      });
    }
    const evento = mapa.get(clave);
    if (partida.eventoCalendario) {
      evento.eventosCalendarioSet.add(partida.eventoCalendario);
    }
    if (
      partida.jornada &&
      partida.jornada !== "Jornada sin indicar"
    ) {
      evento.jornadasSet.add(partida.jornada);
    }
    if (partida.fase) {
      evento.fasesSet.add(partida.fase);
    }
    if (partida.bolera) {
      evento.bolerasSet.add(partida.bolera);
    }
    evento.partidas.push(partida);
  }
  const jornadas = [...mapa.values()]
    .map(evento => {
      const eventosCalendarioLista =
        [...evento.eventosCalendarioSet]
          .sort(compararTexto);
      const jornadasLista =
        [...evento.jornadasSet]
          .sort(compararTexto);
      const fasesLista =
        [...evento.fasesSet]
          .sort(compararTexto);
      const bolerasLista =
        [...evento.bolerasSet]
          .sort(compararTexto);
      const jornadaVisible =
        jornadasLista.length
          ? jornadasLista.join(" · ")
          : "Resultados";
      const faseVisible =
        fasesLista.join(" · ");
      const marcas = [
        ...jornadasLista,
        ...fasesLista
      ];
      return calcularResumenJornada(
        {
          id: evento.id,
          fechaIso: evento.fechaIso,
          fechaMs: evento.fechaMs,
          temporada: evento.temporada,
          competicion: evento.competicion,
          eventoCalendario: eventosCalendarioLista[0] || "",
          eventosCalendario: eventosCalendarioLista,
          jornada: jornadaVisible,
          fase: faseVisible,
          jornadas: jornadasLista,
          fases: fasesLista,
          marcas,
          bolera: bolerasLista.join(" · "),
          partidas: evento.partidas
        },
        mediasTemporada
      );
    })
    .sort((a, b) =>
      b.fechaMs - a.fechaMs ||
      compararTexto(a.competicion, b.competicion)
    );
  return jornadas;
}
function normalizarNombreLiga(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_]+/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}
function normalizarClaveLigaServidor(texto) {
  return normalizarNombreLiga(texto);
}
function nombreJugadorActaLiga(jugador) {
  if (!jugador) return "";
  if (typeof jugador === "string") return jugador;
  return textoLimpio(jugador.jugador || jugador.nombre || jugador.jugadorPinocho || "");
}
function tokensNombreLiga(texto) {
  const equivalencias = {
    PACO: "FRANCISCO",
    FRAN: "FRANCISCO",
    QUIQUE: "ENRIQUE",
    KIKE: "ENRIQUE",
    NACHO: "IGNACIO",
    PEPE: "JOSE"
  };
  return normalizarNombreLiga(texto)
    .split(" ")
    .filter(token => token && token.length >= 3)
    .map(token => equivalencias[token] || token);
}
function coincideNombreJugadorLiga(nombreDatos, nombreActa) {
  const a = normalizarNombreLiga(nombreDatos);
  const b = normalizarNombreLiga(nombreActa);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) return true;
  const pa = tokensNombreLiga(a);
  const pb = tokensNombreLiga(b);
  if (!pa.length || !pb.length) return false;
  const comunes = [...new Set(pa.filter(token => pb.includes(token)))];
  if (comunes.length >= 2) return true;
  if (pa.length === 1 && comunes.length === 1 && pa[0].length >= 4) return true;
  return false;
}
function puntuacionesJugadorActaLiga(jugador) {
  if (!jugador || typeof jugador !== "object") return [];
  const candidatas = [
    jugador.partidas,
    jugador.puntuaciones,
    jugador.juegos,
    jugador.games
  ];
  const lista = candidatas.find(Array.isArray) || [];
  return lista
    .map(valor => {
      if (valor && typeof valor === "object") {
        valor = valor.puntuacion ?? valor.puntos ?? valor.bolos ?? valor.score ?? "";
      }
      const numero = Number(String(valor ?? "").replace(",", ".").trim());
      return Number.isFinite(numero) ? numero : null;
    })
    .filter(valor => valor !== null);
}
function coincideJugadorActaPorPuntuaciones(partidasJugador, jugadorActa) {
  const acta = puntuacionesJugadorActaLiga(jugadorActa);
  if (!acta.length) return false;
  const datos = (partidasJugador || [])
    .slice()
    .sort((a,b) => {
      const na = Number(a.numeroPartida ?? a.numPartida ?? a.numero ?? 0);
      const nb = Number(b.numeroPartida ?? b.numPartida ?? b.numero ?? 0);
      return na - nb;
    })
    .map(partida => Number(partida.puntuacion))
    .filter(Number.isFinite);
  if (datos.length !== acta.length) return false;
  return datos.every((valor, indice) => valor === acta[indice]);
}
function numeroJornadaLiga(texto) {
  const t = normalizarNombreLiga(texto);
  const m = t.match(/(?:^| )(\d+)(?:A|ª|º)?(?: JORNADA|$)/i);
  return m ? Number(m[1]) : null;
}
function claveEventoLigaComparable(texto) {
  return normalizarClaveLigaServidor(texto)
    .replace(/^20\d{2}\s+20\d{2}\s+/, "")
    .trim();
}
function actasDeJornadaLiga(jornada, actasLigaIA) {
  const eventos = [jornada.eventoCalendario, ...(Array.isArray(jornada.eventosCalendario) ? jornada.eventosCalendario : [])]
    .map(claveEventoLigaComparable)
    .filter(Boolean);
  const fechaJornada = textoLimpio(jornada && jornada.fechaIso);
  const numeroJornada = numeroJornadaLiga(jornada && jornada.jornada);
  return (actasLigaIA || []).filter(acta => {
    if (!acta) return false;
    const eventoActa = claveEventoLigaComparable(acta.eventoCalendario);
    if (eventoActa && eventos.some(evento =>
      evento === eventoActa ||
      (evento.length >= 8 && eventoActa.includes(evento)) ||
      (eventoActa.length >= 8 && evento.includes(eventoActa))
    )) return true;
    const fechaActaNormalizada = interpretarFecha(acta.fecha);
    const mismaFecha = Boolean(fechaJornada && fechaActaNormalizada.valida && fechaActaNormalizada.iso === fechaJornada);
    if (!mismaFecha) return false;
    const numeroActa = numeroJornadaLiga(acta.jornada);
    if (numeroJornada !== null && numeroActa !== null && numeroJornada !== numeroActa) return false;
    return true;
  });
}
function numeroDivisionLiga(acta) {
  const texto = normalizarNombreLiga(acta && acta.competicion);
  const m = texto.match(/(?:^| )(\d+)(?:A|ª|º)? DIVISION(?: |$)/i);
  return m ? Number(m[1]) : 999;
}
function construirJornadas(partidasOriginales, actasLigaIA = []) {
  const bases = construirJornadasBase(partidasOriginales);
  const partidasNormalizadas = partidasOriginales
    .map(normalizarPartida)
    .filter(partida => partida.fechaValida && partida.jugador && Number.isFinite(partida.puntuacion));
  const mediasTemporada = calcularMediasTemporada(partidasNormalizadas);
  const salida = [];
  bases.forEach(base => {
    const actas = actasDeJornadaLiga(base, actasLigaIA);
    if (!actas.length) {
      salida.push(base);
      return;
    }
    let creadas = 0;
    actas.slice().sort((a,b) =>
      numeroDivisionLiga(a) - numeroDivisionLiga(b) ||
      compararTexto(textoLimpio(a && a.equipoPinocho), textoLimpio(b && b.equipoPinocho))
    ).forEach(acta => {
      const jugadoresActa = Array.isArray(acta && acta.jugadoresPinocho)
        ? acta.jugadoresPinocho
        : [];
      const nombresActa = jugadoresActa
        .map(nombreJugadorActaLiga)
        .filter(Boolean);
      if (!jugadoresActa.length) return;
      const partidasPorJugador = new Map();
      base.partidas.forEach(partida => {
        const claveJugador = normalizarNombreLiga(partida.jugador);
        if (!partidasPorJugador.has(claveJugador)) partidasPorJugador.set(claveJugador, []);
        partidasPorJugador.get(claveJugador).push(partida);
      });
      const jugadoresCoincidentes = new Set();
      partidasPorJugador.forEach((partidasJugador, claveJugador) => {
        const nombreDatos = partidasJugador[0] && partidasJugador[0].jugador;
        const coincideNombre = nombresActa.some(nombreActa =>
          coincideNombreJugadorLiga(nombreDatos, nombreActa)
        );
        const coincidePuntuaciones = jugadoresActa.some(jugadorActa =>
          coincideJugadorActaPorPuntuaciones(partidasJugador, jugadorActa)
        );
        if (coincideNombre || coincidePuntuaciones) jugadoresCoincidentes.add(claveJugador);
      });
      const partidasEquipo = base.partidas.filter(partida =>
        jugadoresCoincidentes.has(normalizarNombreLiga(partida.jugador))
      );
      if (!partidasEquipo.length) return;
      const equipo = textoLimpio(acta.equipoPinocho) || "Pin Ocho";
      const division = textoLimpio(acta.competicion) || base.competicion;
      const jornadaActa = textoLimpio(acta.jornada) || base.jornada;
      const resumen = calcularResumenJornada({
        id: crearId([base.fechaIso,base.competicion,equipo,division,jornadaActa].join("||")),
        fechaIso: base.fechaIso,
        fechaMs: base.fechaMs,
        temporada: base.temporada,
        competicion: base.competicion,
        eventoCalendario: base.eventoCalendario,
        eventosCalendario: base.eventosCalendario,
        jornada: jornadaActa,
        fase: base.fase,
        jornadas: [jornadaActa],
        fases: base.fases,
        marcas: [equipo,jornadaActa].filter(Boolean),
        bolera: textoLimpio(acta.bolera) || base.bolera,
        partidas: partidasEquipo
      }, mediasTemporada);
      resumen.equipoLiga = equipo;
      resumen.divisionLiga = division;
      resumen.actaLigaIA = acta;
      salida.push(resumen);
      creadas++;
    });
    if (!creadas) salida.push(base);
  });
  return salida.sort((a,b) =>
    b.fechaMs - a.fechaMs ||
    numeroDivisionLiga(a.actaLigaIA) - numeroDivisionLiga(b.actaLigaIA) ||
    compararTexto(a.competicion,b.competicion)
  );
}
function normalizarPartida(fila) {
  const fechaOriginal = obtenerCampo(fila, [
    "Fecha",
    "FECHA",
    "fecha"
  ]);
  const fecha = interpretarFecha(fechaOriginal);
  const jugador = textoLimpio(
    obtenerCampo(fila, [
      "JUGADOR",
      "Jugador",
      "jugador"
    ])
  );
  const competicion = textoLimpio(
    obtenerCampo(fila, [
      "Competicion",
      "COMPETICIÓN",
      "COMPETICION",
      "Competición",
      "competicion"
    ])
  ) || "Competición sin indicar";
  const eventoCalendario = textoLimpio(
    obtenerCampo(fila, [
      "EVENTO CALENDARIO",
      "Evento Calendario",
      "eventoCalendario",
      "evento calendario"
    ])
  );
  const jornada = textoLimpio(
    obtenerCampo(fila, [
      "Torneo/Jornada",
      "TORNEO/JORNADA",
      "Torneo Jornada",
      "JORNADA",
      "Jornada",
      "jornada",
      "torneo"
    ])
  ) || "Jornada sin indicar";
  const fase = textoLimpio(
    obtenerCampo(fila, [
      "Fase",
      "FASE",
      "fase"
    ])
  );
  const temporada = textoLimpio(
    obtenerCampo(fila, [
      "Temporada",
      "TEMPORADA",
      "temporada"
    ])
  ) || obtenerTemporadaDesdeFecha(fecha.fecha);
  const puntuacion = numero(
    obtenerCampo(fila, [
      "PUNTUACION",
      "PUNTUACIÓN",
      "Puntuacion",
      "Puntuación",
      "puntuacion"
    ])
  );
  const numeroPartida = numero(
    obtenerCampo(fila, [
      "NUM_PARTIDA",
      "NumPartida",
      "NUMERO_PARTIDA",
      "Partida",
      "partida"
    ])
  );
  const foto = textoLimpio(
    obtenerCampo(fila, [
      "URL_FOTO",
      "UrlFoto",
      "FOTO",
      "Foto",
      "foto"
    ])
  );
  const alias = textoLimpio(
    obtenerCampo(fila, [
      "ALIAS",
      "Alias",
      "alias"
    ])
  );
  const bolera = textoLimpio(
    obtenerCampo(fila, [
      "Bolera",
      "BOLERA",
      "bolera"
    ])
  );
  return {
    fechaValida: fecha.valida,
    fecha: fecha.fecha,
    fechaIso: fecha.iso,
    fechaMs: fecha.ms,
    temporada,
    competicion,
    eventoCalendario,
    jornada,
    fase,
    jugador,
    alias,
    foto,
    bolera,
    puntuacion,
    numeroPartida
  };
}
function calcularMediasTemporada(partidas) {
  const acumulados = new Map();
  for (const partida of partidas) {
    const clave = [
      partida.temporada,
      partida.jugador
    ].join("||");
    if (!acumulados.has(clave)) {
      acumulados.set(clave, {
        total: 0,
        cantidad: 0
      });
    }
    const dato = acumulados.get(clave);
    dato.total += partida.puntuacion;
    dato.cantidad += 1;
  }
  const medias = new Map();
  for (const [clave, dato] of acumulados.entries()) {
    medias.set(
      clave,
      dato.cantidad
        ? dato.total / dato.cantidad
        : 0
    );
  }
  return medias;
}
function calcularResumenJornada(jornada, mediasTemporada) {
  const jugadoresMap = new Map();
  for (const partida of jornada.partidas) {
    if (!jugadoresMap.has(partida.jugador)) {
      jugadoresMap.set(partida.jugador, {
        nombre: partida.jugador,
        alias: partida.alias,
        foto: partida.foto,
        puntuaciones: [],
        partidasOrdenadas: [],
        fasesMap: new Map()
      });
    }
    const jugador = jugadoresMap.get(partida.jugador);
    jugador.puntuaciones.push(partida.puntuacion);
    jugador.partidasOrdenadas.push({
      numero: Number.isFinite(partida.numeroPartida)
        ? partida.numeroPartida
        : jugador.partidasOrdenadas.length + 1,
      puntuacion: partida.puntuacion
    });
    const fasePartida =
      textoLimpio(partida.fase) ||
      "Sin fase";
    if (!jugador.fasesMap.has(fasePartida)) {
      jugador.fasesMap.set(
        fasePartida,
        []
      );
    }
    jugador.fasesMap
      .get(fasePartida)
      .push(partida.puntuacion);
  }
  const jugadores = [...jugadoresMap.values()]
    .map(jugador => {
      jugador.partidasOrdenadas.sort((a, b) => a.numero - b.numero);
      const total = sumar(jugador.puntuaciones);
      const promedio = total / jugador.puntuaciones.length;
      const maxima = Math.max(...jugador.puntuaciones);
      const minima = Math.min(...jugador.puntuaciones);
      const rango = maxima - minima;
      const cantidad200 = jugador.puntuaciones.filter(v => v >= 200).length;
      const primera = jugador.partidasOrdenadas[0]?.puntuacion ?? 0;
      const ultima = jugador.partidasOrdenadas.at(-1)?.puntuacion ?? 0;
      /*
        MEJOR SEGUNDA VUELTA
        - Con 3 partidas:
          compara la última con la media de las dos primeras.
        - Con 4 o más:
          compara la media de la segunda mitad con la primera.
          Si el número es impar, la partida central se incluye
          en la segunda mitad.
        - Con menos de 3:
          no se concede este reconocimiento.
      */
      let mejoraSegundaVuelta = null;
      let mediaPrimeraVuelta = null;
      let mediaSegundaVuelta = null;
      if (jugador.partidasOrdenadas.length >= 3) {
        const puntuacionesOrdenadas =
          jugador.partidasOrdenadas.map(
            partida => partida.puntuacion
          );
        if (puntuacionesOrdenadas.length === 3) {
          mediaPrimeraVuelta =
            (
              puntuacionesOrdenadas[0]
              +
              puntuacionesOrdenadas[1]
            )
            / 2;
          mediaSegundaVuelta =
            puntuacionesOrdenadas[2];
        } else {
          const puntoCorte =
            Math.floor(
              puntuacionesOrdenadas.length / 2
            );
          const primeraMitad =
            puntuacionesOrdenadas.slice(
              0,
              puntoCorte
            );
          const segundaMitad =
            puntuacionesOrdenadas.slice(
              puntoCorte
            );
          mediaPrimeraVuelta =
            sumar(primeraMitad)
            /
            primeraMitad.length;
          mediaSegundaVuelta =
            sumar(segundaMitad)
            /
            segundaMitad.length;
        }
        mejoraSegundaVuelta =
          mediaSegundaVuelta
          -
          mediaPrimeraVuelta;
      }
      const claveMedia = [
        jornada.temporada,
        jugador.nombre
      ].join("||");
      const mediaTemporada =
        mediasTemporada.get(claveMedia) || promedio;
      const progreso = promedio - mediaTemporada;
      const fasesDetalle =
        [...jugador.fasesMap.entries()]
          .map(([nombre, puntuaciones]) => {
            const totalFase =
              sumar(puntuaciones);
            return {
              nombre,
              partidas:
                puntuaciones.length,
              total:
                totalFase,
              promedio:
                puntuaciones.length
                  ? totalFase /
                    puntuaciones.length
                  : 0,
              maxima:
                puntuaciones.length
                  ? Math.max(
                      ...puntuaciones
                    )
                  : 0
            };
          });
      return {
        ...jugador,
        fasesMap: undefined,
        fasesDetalle,
        total,
        promedio,
        maxima,
        minima,
        rango,
        cantidad200,
        primera,
        ultima,
        mejoraSegundaVuelta,
        mediaPrimeraVuelta,
        mediaSegundaVuelta,
        mediaTemporada,
        progreso
      };
    })
    .sort((a, b) =>
      b.promedio - a.promedio ||
      b.maxima - a.maxima ||
      compararTexto(a.nombre, b.nombre)
    );
  const todasPuntuaciones =
    jugadores.flatMap(jugador => jugador.puntuaciones);
  const mediaEquipo = todasPuntuaciones.length
    ? sumar(todasPuntuaciones) / todasPuntuaciones.length
    : 0;
  const mejorPromedio =
    [...jugadores].sort((a, b) =>
      b.promedio - a.promedio ||
      b.maxima - a.maxima
    )[0] || null;
  const mejorPartida =
    [...jugadores].sort((a, b) =>
      b.maxima - a.maxima ||
      b.promedio - a.promedio
    )[0] || null;
  const mayorProgreso =
    [...jugadores].sort((a, b) =>
      b.progreso - a.progreso ||
      b.promedio - a.promedio
    )[0] || null;
  const masRegular =
    [...jugadores]
      .filter(jugador => jugador.puntuaciones.length >= 3)
      .sort((a, b) =>
        a.rango - b.rango ||
        b.promedio - a.promedio
      )[0] || null;
  const rey200 =
    [...jugadores].sort((a, b) =>
      b.cantidad200 - a.cantidad200 ||
      b.maxima - a.maxima
    )[0] || null;
  const mejorSegundaVuelta =
    [...jugadores]
      .filter(
        jugador =>
          jugador.mejoraSegundaVuelta !== null
      )
      .sort((a, b) =>
        b.mejoraSegundaVuelta
        -
        a.mejoraSegundaVuelta
        ||
        b.mediaSegundaVuelta
        -
        a.mediaSegundaVuelta
      )[0] || null;
  const montanaRusa =
    [...jugadores]
      .filter(jugador => jugador.puntuaciones.length >= 2)
      .sort((a, b) =>
        b.rango - a.rango ||
        b.maxima - a.maxima
      )[0] || null;
  const total200 =
    todasPuntuaciones.filter(v => v >= 200).length;
  return {
    ...jornada,
    jugadores,
    mediaEquipo,
    totalPartidas: todasPuntuaciones.length,
    totalJugadores: jugadores.length,
    total200,
    mejorPromedio,
    mejorPartida,
    mayorProgreso,
    masRegular,
    rey200,
    mejorSegundaVuelta,
    montanaRusa,
    titular: generarTitular({
      mejorPromedio,
      mejorPartida,
      mayorProgreso,
      mediaEquipo,
      total200,
      fase: jornada.fase
    })
  };
}
function generarTitular(datos) {
  if (!datos.mejorPromedio) {
    return "Una nueva jornada de Pin Ocho";
  }
  const nombre = nombreVisible(datos.mejorPromedio);
  const promedio = formatearNumero(datos.mejorPromedio.promedio);
  if (
    datos.mejorPartida &&
    datos.mejorPartida.maxima >= 240
  ) {
    return `${nombre} lidera una jornada marcada por una partida de ${datos.mejorPartida.maxima}`;
  }
  if (
    datos.mayorProgreso &&
    datos.mayorProgreso.progreso >= 15
  ) {
    return `${nombre} manda y ${nombreVisible(datos.mayorProgreso)} firma la gran sorpresa`;
  }
  if (datos.mediaEquipo >= 190) {
    return `${nombre} encabeza una actuación colectiva por encima de 190`;
  }
  if (datos.total200 >= 5) {
    return `${nombre} lidera una jornada con ${datos.total200} partidas de 200 o más`;
  }
  return `${nombre} se lleva los honores con ${promedio} de promedio`;
}
function construirPagina(
  jornadas,
  torneosFinalizados = [],
  resultadosTorneos = [],
  cronicasResultados = []
) {
  const jornadasJson = JSON.stringify(jornadas)
    .replace(/</g, "\u003c")
    .replace(/<\/script/gi, "<\/script");
  const torneosFinalizadosJson =
    JSON.stringify(torneosFinalizados)
      .replace(/</g, "\u003c")
      .replace(/<\/script/gi, "<\/script");
  const resultadosTorneosJson =
    JSON.stringify(resultadosTorneos)
      .replace(/</g, "\u003c")
      .replace(/<\/script/gi, "<\/script");
  const cronicasResultadosJson =
    JSON.stringify(cronicasResultados)
      .replace(/</g, "\u003c")
      .replace(/<\/script/gi, "<\/script");
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >
  <title>Resultados - Club de Bowling Pin Ocho</title>
  <style>
    :root {
      --fondo: #21140d;
      --fondo-profundo: #140d08;
      --panel: #2a1b12;
      --panel-suave: #342219;
      --panel-claro: #3b281d;
      --dorado: #d6a84c;
      --dorado-claro: #f0d08a;
      --texto: #fffaf0;
      --texto-suave: #d9c7ae;
      --borde: rgba(214, 168, 76, 0.42);
      --borde-suave: rgba(214, 168, 76, 0.20);
      --sombra: 0 18px 44px rgba(0, 0, 0, 0.28);
      --verde: #9ad39a;
      --rojo-suave: #eba7a7;
    }
    * {
      box-sizing: border-box;
    }
    html {
      scroll-behavior: smooth;
      background: var(--fondo-profundo);
    }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--texto);
      background:
        radial-gradient(
          circle at 15% 0%,
          rgba(214, 168, 76, 0.13),
          transparent 34%
        ),
        linear-gradient(
          180deg,
          #281911 0%,
          var(--fondo) 40%,
          var(--fondo-profundo) 100%
        );
    }
    button,
    select {
      font: inherit;
    }
    .contenedor {
      max-width: 1180px;
      margin: auto;
      padding: 28px 24px 42px;
    }
    .cabecera {
      position: relative;
      overflow: hidden;
      margin-bottom: 24px;
      padding: 38px 28px 34px;
      text-align: center;
      background:
        linear-gradient(
          135deg,
          rgba(214, 168, 76, 0.16),
          transparent 46%
        ),
        linear-gradient(
          180deg,
          #312016,
          #24170f
        );
      border: 1px solid var(--borde);
      border-radius: 22px;
      box-shadow: var(--sombra);
    }
    .cabecera::before,
    .cabecera::after {
      content: "";
      position: absolute;
      width: 180px;
      height: 180px;
      border: 1px solid rgba(214, 168, 76, 0.12);
      border-radius: 50%;
      pointer-events: none;
    }
    .cabecera::before {
      top: -110px;
      left: -70px;
    }
    .cabecera::after {
      right: -80px;
      bottom: -120px;
    }
    .eyebrow {
      margin-bottom: 10px;
      color: var(--dorado-claro);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }
    .cabecera h1 {
      margin: 0;
      font-size: clamp(36px, 6vw, 62px);
      line-height: 1;
      letter-spacing: -0.045em;
    }
    .cabecera p {
      max-width: 760px;
      margin: 15px auto 0;
      color: var(--texto-suave);
      font-size: 16px;
      line-height: 1.65;
    }
    .navegacion-interna {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 24px;
      padding: 8px;
      background: var(--panel);
      border: 1px solid var(--borde);
      border-radius: 16px;
      box-shadow: var(--sombra);
    }
    .pestana {
      min-width: 180px;
      cursor: pointer;
      padding: 12px 20px;
      color: var(--texto-suave);
      font-weight: 900;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 11px;
    }
    .pestana.activa {
      color: #21140d;
      background: linear-gradient(
        180deg,
        #f1d58b,
        #d6a84c
      );
      border-color: var(--dorado);
    }
    .vista-oculta {
      display: none !important;
    }
    .selectores-portada { display:grid;grid-template-columns:1fr 1.5fr;gap:18px;margin-bottom:28px;padding:24px;background:var(--panel);border:1px solid var(--borde);border-radius:18px; }
    .selectores-portada .grupo-filtro label {display:block;color:var(--dorado-claro);font-size:13px;font-weight:800;margin-bottom:9px;}
    .selectores-portada select {width:100%;min-height:49px;padding:10px 14px;color:var(--texto);background:#1d120c;border:1px solid var(--borde);border-radius:10px;}
    .rejilla-portada-informes {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:20px 0 28px;}
    .tarjeta-informe-portada {cursor:pointer;min-height:155px;padding:20px;text-align:left;background:var(--panel);color:var(--texto);border:1px solid var(--borde);border-radius:17px;box-shadow:var(--sombra);display:flex;flex-direction:column;gap:12px;transition:transform .15s,border-color .15s;}
    .tarjeta-informe-portada:hover {transform:translateY(-3px);border-color:var(--dorado-claro);}
    .tarjeta-informe-portada strong {color:var(--dorado-claro);font-size:17px;line-height:1.3;}
    .tarjeta-informe-portada small {color:var(--texto-suave);font-size:12px;}
    .tarjeta-informe-portada .tarjeta-pie {margin-top:auto;display:flex;justify-content:space-between;gap:10px;align-items:center;}
    @media(max-width:720px){.selectores-portada{grid-template-columns:1fr;padding:16px;}.rejilla-portada-informes{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}.tarjeta-informe-portada{padding:14px;min-height:140px;}}
    @media(max-width:430px){.rejilla-portada-informes{grid-template-columns:1fr;}}
    .portada-resultados {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .opcion-resultados {
      cursor: pointer;
      min-height: 150px;
      padding: 22px;
      text-align: left;
      color: var(--texto);
      background:
        radial-gradient(circle at 100% 0%, rgba(214,168,76,0.13), transparent 42%),
        linear-gradient(180deg, rgba(255,255,255,0.025), transparent),
        var(--panel);
      border: 1px solid var(--borde);
      border-radius: 20px;
      box-shadow: var(--sombra);
      transition: transform .2s ease, border-color .2s ease;
    }
    .opcion-resultados:hover {
      transform: translateY(-3px);
      border-color: var(--dorado-claro);
    }
    .opcion-resultados-icono {
      display: block;
      margin-bottom: 13px;
      font-size: 26px;
      line-height: 1;
    }
    .opcion-resultados strong {
      display: block;
      color: var(--dorado-claro);
      font-size: 20px;
      line-height: 1.15;
    }
    .opcion-resultados span {
      display: block;
      margin-top: 8px;
      color: var(--texto-suave);
      font-size: 13px;
      line-height: 1.4;
    }
    .barra-volver-resultados {
      margin: 0 0 16px;
    }
    .boton-volver-resultados {
      cursor: pointer;
      padding: 9px 13px;
      color: var(--dorado-claro);
      font-weight: 800;
      background: rgba(214,168,76,0.07);
      border: 1px solid var(--borde-suave);
      border-radius: 11px;
    }
    .panel-palmares-filtro {
      margin-bottom: 24px;
      padding: 20px 24px;
      background: var(--panel);
      border: 1px solid var(--borde);
      border-radius: 18px;
      box-shadow: var(--sombra);
    }
    .panel-palmares-filtro label {
      display: block;
      margin-bottom: 7px;
      color: var(--texto-suave);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .panel-palmares-filtro select {
      width: min(420px, 100%);
      min-height: 50px;
      padding: 12px 15px;
      color: var(--texto);
      background: #1d120c;
      border: 1px solid rgba(214,168,76,0.52);
      border-radius: 13px;
    }
    .meses-grid {
      display: grid;
      grid-template-columns:
        repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    .mes-card {
      padding: 18px;
      background:
        linear-gradient(
          180deg,
          rgba(255,255,255,0.022),
          transparent
        ),
        var(--panel);
      border: 1px solid var(--borde-suave);
      border-radius: 17px;
      box-shadow: var(--sombra);
    }
    .mes-card-titulo {
      color: var(--dorado-claro);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .mes-card-jugador {
      margin-top: 10px;
      font-size: 22px;
      font-weight: 900;
      line-height: 1.15;
    }
    .mes-card-mejora {
      margin-top: 8px;
      color: var(--dorado-claro);
      font-size: 18px;
      font-weight: 900;
    }
    .mes-card-detalle {
      margin-top: 7px;
      color: var(--texto-suave);
      font-size: 13px;
      line-height: 1.45;
    }
    .panel-filtros {
      margin-bottom: 24px;
      padding: 22px 24px 24px;
      background:
        linear-gradient(
          180deg,
          rgba(255,255,255,0.018),
          transparent
        ),
        var(--panel);
      border: 1px solid var(--borde);
      border-radius: 20px;
      box-shadow: var(--sombra);
    }
    .titulo-panel {
      margin-bottom: 16px;
      color: var(--dorado-claro);
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .filtros {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }
    .grupo-filtro label {
      display: block;
      margin-bottom: 7px;
      color: var(--texto-suave);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .grupo-filtro select {
      width: 100%;
      min-height: 52px;
      padding: 12px 15px;
      color: var(--texto);
      font-size: 15px;
      border: 1px solid rgba(214, 168, 76, 0.52);
      border-radius: 14px;
      outline: none;
      background-color: #1d120c;
    }
    .grupo-filtro select:focus {
      border-color: var(--dorado-claro);
      box-shadow: 0 0 0 3px rgba(214, 168, 76, 0.16);
    }
    .seccion {
      margin-top: 28px;
    }
    .cabecera-seccion {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 15px;
    }
    .cabecera-seccion h2 {
      margin: 0;
      font-size: clamp(24px, 4vw, 34px);
      letter-spacing: -0.025em;
    }
    .cabecera-seccion p {
      margin: 0;
      color: var(--texto-suave);
      font-size: 13px;
    }
    .jornada-principal {
      overflow: hidden;
      background:
        linear-gradient(
          135deg,
          rgba(214,168,76,0.12),
          transparent 42%
        ),
        var(--panel);
      border: 1px solid var(--borde);
      border-radius: 24px;
      box-shadow: var(--sombra);
    }
    .portada-jornada {
      padding: 30px 30px 25px;
      border-bottom: 1px solid var(--borde-suave);
    }
    .linea-superior {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .insignia {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 6px 12px;
      color: #21140d;
      font-size: 12px;
      font-weight: 900;
      background: linear-gradient(180deg, #f1d58b, #d6a84c);
      border: 1px solid var(--dorado);
      border-radius: 999px;
    }
    .meta {
      color: var(--texto-suave);
      font-size: 13px;
      font-weight: 700;
    }
    .portada-jornada h2 {
      max-width: 880px;
      margin: 0;
      font-size: clamp(28px, 5vw, 48px);
      line-height: 1.1;
      letter-spacing: -0.035em;
    }
    .subtitulo-jornada {
      margin-top: 12px;
      color: var(--dorado-claro);
      font-size: 15px;
      font-weight: 700;
    }
    .participantes-jornada {
      margin-top: 18px;
      padding: 14px 16px;
      color: var(--texto-suave);
      font-size: 14px;
      line-height: 1.55;
      background: rgba(214,168,76,0.07);
      border: 1px solid var(--borde-suave);
      border-radius: 14px;
    }
    .participantes-jornada strong {
      color: var(--dorado-claro);
    }
    .cronica-torneo {
      padding: 22px;
      border-top: 1px solid var(--borde-suave);
    }
    .cronica-intro {
      margin: 0 0 14px;
      color: var(--texto-suave);
      font-size: 15px;
      line-height: 1.65;
    }
    .cronica-jugadores {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .cronica-jugador {
      padding: 16px;
      background: var(--panel-suave);
      border: 1px solid var(--borde-suave);
      border-radius: 14px;
    }
    .cronica-jugador-cabecera {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .cronica-jugador h3 {
      margin: 0;
      font-size: 18px;
    }
    .cronica-puesto {
      flex: 0 0 auto;
      padding: 5px 9px;
      color: #21140d;
      background: var(--dorado-claro);
      border-radius: 999px;
      font-size: 11px;
      font-weight: 900;
    }
    .cronica-texto {
      margin: 0;
      color: var(--texto-suave);
      font-size: 13px;
      line-height: 1.55;
    }
    .cronica-fases {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .cronica-fase {
      padding: 5px 8px;
      color: var(--dorado-claro);
      background: rgba(214,168,76,0.08);
      border: 1px solid var(--borde-suave);
      border-radius: 999px;
      font-size: 10px;
      font-weight: 800;
    }
    .cronica-observacion {
      margin-top: 10px;
      padding: 10px 11px;
      color: var(--texto);
      background: rgba(255,255,255,0.025);
      border-left: 3px solid var(--dorado);
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.5;
    }
    .informe-individual {
      padding: 22px;
    }
    .individual-cabecera {
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 20px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.025), transparent),
        var(--panel-suave);
      border: 1px solid var(--borde-suave);
      border-radius: 18px;
    }
    .individual-icono {
      width: 66px;
      min-width: 66px;
      height: 66px;
      display: grid;
      place-items: center;
      font-size: 34px;
      background: rgba(214,168,76,0.11);
      border: 1px solid var(--borde);
      border-radius: 16px;
    }
    .individual-nombre {
      font-size: 27px;
      font-weight: 900;
      line-height: 1.12;
    }
    .individual-texto {
      margin-top: 6px;
      color: var(--texto-suave);
      font-size: 14px;
    }
    .individual-datos {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }
    .individual-dato {
      padding: 17px 12px;
      text-align: center;
      background: var(--panel-suave);
      border: 1px solid var(--borde-suave);
      border-radius: 14px;
    }
    .individual-dato strong {
      display: block;
      color: var(--dorado-claro);
      font-size: 24px;
    }
    .individual-dato span {
      display: block;
      margin-top: 5px;
      color: var(--texto-suave);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .partidas-individuales {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      margin-top: 15px;
    }
    .partida-individual {
      min-width: 58px;
      padding: 10px 9px;
      text-align: center;
      color: var(--texto);
      background: #1d120c;
      border: 1px solid var(--borde-suave);
      border-radius: 11px;
    }
    .partida-individual small {
      display: block;
      margin-bottom: 4px;
      color: var(--texto-suave);
      font-size: 9px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .partida-individual strong {
      font-size: 17px;
    }
    .premios {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      padding: 22px;
    }
    .premio {
      min-height: 166px;
      padding: 18px;
      background:
        linear-gradient(
          180deg,
          rgba(255,255,255,0.025),
          transparent
        ),
        var(--panel-suave);
      border: 1px solid var(--borde-suave);
      border-radius: 17px;
    }
    .premio-destacado {
      border-color: rgba(240, 208, 138, 0.62);
      background:
        radial-gradient(
          circle at 90% 0%,
          rgba(214,168,76,0.15),
          transparent 35%
        ),
        var(--panel-claro);
    }
    .premio-icono {
      margin-bottom: 12px;
      font-size: 27px;
    }
    .premio-etiqueta {
      color: var(--texto-suave);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.11em;
      text-transform: uppercase;
    }
    .premio-nombre {
      margin-top: 8px;
      font-size: 21px;
      font-weight: 900;
      line-height: 1.15;
    }
    .premio-valor {
      margin-top: 7px;
      color: var(--dorado-claro);
      font-size: 14px;
      font-weight: 800;
    }
    .curiosidades {
      padding: 0 22px 22px;
    }
    .curiosidades-titulo {
      margin: 0 0 12px;
      color: var(--dorado-claro);
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .curiosidades-lista {
      display: grid;
      gap: 10px;
    }
    .curiosidad {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      color: var(--texto);
      background:
        linear-gradient(
          180deg,
          rgba(255,255,255,0.02),
          transparent
        ),
        var(--panel-suave);
      border: 1px solid var(--borde-suave);
      border-radius: 14px;
    }
    .curiosidad-icono {
      flex: 0 0 auto;
      font-size: 22px;
      line-height: 1;
    }
    .curiosidad-texto {
      color: var(--texto-suave);
      font-size: 14px;
      line-height: 1.5;
    }
    .curiosidad-texto strong {
      color: var(--texto);
    }
    .jugador-mes {
      display: grid;
      grid-template-columns:
        auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 18px;
      padding: 22px 24px;
      background:
        radial-gradient(
          circle at 100% 0%,
          rgba(214,168,76,0.17),
          transparent 35%
        ),
        var(--panel);
      border: 1px solid var(--borde);
      border-radius: 20px;
      box-shadow: var(--sombra);
    }
    .jugador-mes-icono {
      width: 64px;
      height: 64px;
      display: grid;
      place-items: center;
      font-size: 33px;
      background: rgba(214,168,76,0.10);
      border: 1px solid var(--borde);
      border-radius: 17px;
    }
    .jugador-mes-etiqueta {
      color: var(--dorado-claro);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .jugador-mes-nombre {
      margin-top: 6px;
      font-size: 26px;
      font-weight: 900;
      line-height: 1.1;
    }
    .jugador-mes-detalle {
      margin-top: 7px;
      color: var(--texto-suave);
      font-size: 14px;
      line-height: 1.45;
    }
    .jugador-mes-mejora {
      min-width: 135px;
      padding: 14px 16px;
      text-align: center;
      color: #21140d;
      background:
        linear-gradient(
          180deg,
          #f1d58b,
          #d6a84c
        );
      border: 1px solid var(--dorado);
      border-radius: 14px;
    }
    .jugador-mes-mejora strong {
      display: block;
      font-size: 25px;
    }
    .jugador-mes-mejora span {
      display: block;
      margin-top: 4px;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .palmares {
      overflow: hidden;
      background:
        linear-gradient(
          135deg,
          rgba(214,168,76,0.10),
          transparent 45%
        ),
        var(--panel);
      border: 1px solid var(--borde);
      border-radius: 22px;
      box-shadow: var(--sombra);
    }
    .palmares-cabecera {
      padding: 23px 24px 18px;
      border-bottom: 1px solid var(--borde-suave);
    }
    .palmares-cabecera h3 {
      margin: 0;
      font-size: 25px;
    }
    .palmares-cabecera p {
      margin: 7px 0 0;
      color: var(--texto-suave);
      font-size: 13px;
      line-height: 1.5;
    }
    .palmares-categorias {
      display: grid;
      grid-template-columns:
        repeat(3, minmax(0, 1fr));
      gap: 12px;
      padding: 18px;
    }
    .titulo-categoria {
      padding: 15px;
      background: var(--panel-suave);
      border: 1px solid var(--borde-suave);
      border-radius: 14px;
    }
    .titulo-categoria-icono {
      font-size: 23px;
    }
    .titulo-categoria-nombre {
      margin-top: 8px;
      color: var(--texto-suave);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }
    .titulo-categoria-lider {
      margin-top: 7px;
      font-size: 18px;
      font-weight: 900;
      line-height: 1.2;
    }
    .titulo-categoria-valor {
      margin-top: 5px;
      color: var(--dorado-claro);
      font-size: 13px;
      font-weight: 800;
    }
    .ranking-titulos {
      padding: 0 18px 18px;
    }
    .ranking-titulos h4 {
      margin: 0 0 10px;
      color: var(--dorado-claro);
      font-size: 13px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .ranking-titulos-lista {
      display: grid;
      gap: 8px;
    }
    .ranking-titulo-fila {
      display: grid;
      grid-template-columns:
        46px minmax(130px, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      background: rgba(214,168,76,0.06);
      border: 1px solid var(--borde-suave);
      border-radius: 12px;
    }
    .ranking-posicion {
      color: var(--dorado-claro);
      font-weight: 900;
    }
    .ranking-jugador {
      font-weight: 900;
    }
    .ranking-total {
      color: var(--dorado-claro);
      font-weight: 900;
      white-space: nowrap;
    }
    .resumen-numerico {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border-top: 1px solid var(--borde-suave);
    }
    .dato {
      padding: 19px 14px;
      text-align: center;
      border-right: 1px solid var(--borde-suave);
    }
    .dato:last-child {
      border-right: 0;
    }
    .dato strong {
      display: block;
      color: var(--dorado-claro);
      font-size: 24px;
    }
    .dato span {
      display: block;
      margin-top: 4px;
      color: var(--texto-suave);
      font-size: 12px;
    }
    .acciones-jornada {
      display: flex;
      justify-content: center;
      padding: 0 22px 24px;
    }
    .boton {
      appearance: none;
      cursor: pointer;
      padding: 12px 20px;
      color: #21140d;
      font-weight: 900;
      background: linear-gradient(180deg, #f1d58b, #d6a84c);
      border: 1px solid var(--dorado);
      border-radius: 11px;
      box-shadow: 0 7px 18px rgba(0,0,0,0.2);
      transition: transform 0.18s ease, filter 0.18s ease;
    }
    .boton:hover {
      transform: translateY(-1px);
      filter: brightness(1.04);
    }
    .rejilla-jornadas {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }
    .tarjeta-jornada {
      display: flex;
      flex-direction: column;
      min-height: 270px;
      padding: 20px;
      background:
        linear-gradient(
          180deg,
          rgba(255,255,255,0.022),
          transparent
        ),
        var(--panel);
      border: 1px solid var(--borde-suave);
      border-radius: 18px;
      box-shadow: var(--sombra);
    }
    .tarjeta-jornada h3 {
      margin: 13px 0 7px;
      font-size: 23px;
      line-height: 1.15;
    }
    .tarjeta-meta {
      color: var(--texto-suave);
      font-size: 13px;
      line-height: 1.5;
    }
    .mini-destacado {
      margin-top: 18px;
      padding: 13px;
      background: rgba(214,168,76,0.08);
      border: 1px solid var(--borde-suave);
      border-radius: 13px;
    }
    .mini-destacado span {
      display: block;
      color: var(--texto-suave);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .mini-destacado strong {
      display: block;
      margin-top: 6px;
      font-size: 16px;
    }
    .tarjeta-acciones {
      margin-top: auto;
      padding-top: 18px;
    }
    .boton-secundario {
      width: 100%;
      cursor: pointer;
      padding: 11px 15px;
      color: var(--dorado-claro);
      font-weight: 900;
      background: transparent;
      border: 1px solid rgba(214,168,76,0.48);
      border-radius: 10px;
    }
    .boton-secundario:hover {
      background: rgba(214,168,76,0.08);
    }
    .detalle {
      display: none;
      margin-top: 18px;
      padding: 24px;
      background: var(--panel);
      border: 1px solid var(--borde);
      border-radius: 20px;
      box-shadow: var(--sombra);
    }
    .detalle.visible {
      display: block;
    }
    .detalle-cabecera {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 20px;
    }
    .detalle-cabecera h2 {
      margin: 0;
      font-size: clamp(25px, 4vw, 37px);
    }
    .cerrar {
      cursor: pointer;
      padding: 8px 11px;
      color: var(--texto);
      background: transparent;
      border: 1px solid var(--borde);
      border-radius: 9px;
    }
    .tabla-jugadores {
      display: grid;
      gap: 10px;
    }
    .fila-jugador {
      display: grid;
      grid-template-columns: minmax(150px, 1.5fr) repeat(4, minmax(80px, 0.7fr));
      align-items: center;
      gap: 10px;
      padding: 13px 14px;
      background: var(--panel-suave);
      border: 1px solid var(--borde-suave);
      border-radius: 12px;
    }
    .fila-jugador.cabecera-tabla {
      color: var(--dorado-claro);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      background: transparent;
      border-color: transparent;
    }
    .jugador-nombre {
      font-weight: 900;
    }
    .valor-positivo {
      color: var(--verde);
      font-weight: 800;
    }
    .valor-negativo {
      color: var(--rojo-suave);
      font-weight: 800;
    }
    .sin-resultados {
      padding: 34px;
      color: var(--texto-suave);
      text-align: center;
      background: var(--panel);
      border: 1px solid var(--borde);
      border-radius: 18px;
      box-shadow: var(--sombra);
    }
    .oculto {
      display: none !important;
    }
    .pie {
      margin-top: 30px;
      padding: 18px 20px;
      color: var(--texto-suave);
      font-size: 13px;
      text-align: center;
      border-top: 1px solid rgba(214, 168, 76, 0.22);
    }
    .pie strong {
      color: var(--dorado-claro);
    }
    @media (max-width: 930px) {
      .premios {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .rejilla-jornadas {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 700px) {
      .contenedor {
        padding: 14px 12px 30px;
      }
      .cabecera {
        padding: 29px 18px 25px;
        border-radius: 18px;
      }
      .cabecera h1 {
        font-size: 39px;
      }
      .cabecera p {
        font-size: 14px;
      }
      .navegacion-interna {
        gap: 7px;
        padding: 6px;
      }
      .pestana {
        min-width: 0;
        flex: 1;
        padding: 11px 8px;
        font-size: 13px;
      }
      .portada-resultados {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 7px;
        margin-bottom: 14px;
      }
      .opcion-resultados {
        min-width: 0;
        min-height: 92px;
        padding: 10px 6px;
        text-align: center;
        border-radius: 13px;
      }
      .opcion-resultados-icono {
        margin-bottom: 7px;
        font-size: 20px;
      }
      .opcion-resultados strong {
        font-size: 12px;
        line-height: 1.12;
      }
      .opcion-resultados span {
        display: none;
      }
      .barra-volver-resultados {
        margin-bottom: 10px;
      }
      .boton-volver-resultados {
        width: 100%;
        padding: 8px 10px;
        font-size: 12px;
      }
      .meses-grid {
        grid-template-columns: 1fr;
      }
      .panel-filtros {
        padding: 18px 14px;
        border-radius: 16px;
      }
      .filtros {
        grid-template-columns: 1fr;
      }
      .cabecera-seccion {
        display: block;
      }
      .cabecera-seccion p {
        margin-top: 6px;
      }
      .portada-jornada {
        padding: 22px 17px 20px;
      }
      .jugador-mes {
        grid-template-columns:
          54px minmax(0, 1fr);
        gap: 13px;
        padding: 17px 15px;
      }
      .jugador-mes-icono {
        width: 54px;
        height: 54px;
        font-size: 28px;
      }
      .jugador-mes-nombre {
        font-size: 21px;
      }
      .jugador-mes-mejora {
        grid-column: 1 / -1;
        width: 100%;
      }
      .palmares-categorias {
        grid-template-columns: 1fr;
        padding: 14px;
      }
      .ranking-titulos {
        padding: 0 14px 14px;
      }
      .ranking-titulo-fila {
        grid-template-columns:
          38px minmax(100px, 1fr) auto;
        padding: 11px;
      }
      .premios {
        grid-template-columns: 1fr;
        padding: 14px;
      }
      .premio {
        min-height: auto;
      }
      .resumen-numerico {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .dato:nth-child(2) {
        border-right: 0;
      }
      .dato:nth-child(-n+2) {
        border-bottom: 1px solid var(--borde-suave);
      }
      .rejilla-jornadas {
        grid-template-columns: 1fr;
      }
      .detalle {
        padding: 17px 12px;
      }
      .detalle-cabecera {
        display: block;
      }
      .cerrar {
        width: 100%;
        margin-top: 12px;
      }
      .individual-cabecera {
        align-items: flex-start;
        padding: 16px;
      }
      .individual-icono {
        width: 54px;
        min-width: 54px;
        height: 54px;
        font-size: 28px;
      }
      .individual-nombre {
        font-size: 22px;
      }
      .individual-datos {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .tabla-jugadores {
        gap: 12px;
      }
      .fila-jugador.cabecera-tabla {
        display: none;
      }
      .fila-jugador {
        grid-template-columns: 1fr 1fr;
      }
      .fila-jugador > div::before {
        display: block;
        margin-bottom: 3px;
        color: var(--texto-suave);
        font-size: 9px;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .fila-jugador > div:nth-child(1) {
        grid-column: 1 / -1;
        font-size: 18px;
      }
      .fila-jugador > div:nth-child(2)::before {
        content: "Promedio";
      }
      .fila-jugador > div:nth-child(3)::before {
        content: "Mejor partida";
      }
      .fila-jugador > div:nth-child(4)::before {
        content: "Sobre su media";
      }
      .fila-jugador > div:nth-child(5)::before {
        content: "Partidas";
      }
      .cronica-jugadores {
        grid-template-columns: 1fr;
      }
      .cronica-torneo {
        padding: 16px;
      }
      .cronica-jugador {
        padding: 13px;
      }
    }
  </style>
</head>
<body>
  <div class="contenedor">
    <header class="cabecera">
      <div class="eyebrow">Club Bowling Pin Ocho</div>
      <h1>Resultados</h1>
      <p>
        Los protagonistas, las sorpresas y el pequeño salseo
        que deja cada jornada del club.
      </p>
    </header>
    ${
      jornadas.length
        ? `
          <nav class="navegacion-interna">
            <button
              id="pestanaResultados"
              class="pestana activa"
              onclick="cambiarVista('resultados')"
            >
              Resultados
            </button>
            <button
              id="pestanaPalmares"
              class="pestana"
              onclick="cambiarVista('palmares')"
            >
              Palmarés
            </button>
          </nav>
          <div id="vistaResultados">
            <section id="portadaResultados" class="nueva-portada-resultados">
              <div class="selectores-portada">
                <div class="grupo-filtro"><label for="filtroTemporada">Temporada</label><select id="filtroTemporada" onchange="cambiarTemporadaPortada()"></select></div>
                <div class="grupo-filtro"><label for="selectorInformePortada">Informe generado</label><select id="selectorInformePortada" onchange="abrirInformeSeleccionado()"><option value="">Seleccionar informe...</option></select></div>
              </div>
              <div class="cabecera-seccion"><h2>Últimos 9 informes</h2><p>Acceso directo a los resultados más recientes de la temporada</p></div>
              <div id="tarjetasInformesPortada" class="rejilla-portada-informes"></div>
            </section>
            <div id="barraVolverResultados" class="barra-volver-resultados vista-oculta"><button class="boton-volver-resultados" onclick="mostrarPortadaResultados()">← Volver a los 9 informes</button></div>
            <section id="panelBuscadorResultados" class="vista-oculta">
              <select id="filtroCompeticion" onchange="alCambiarFiltro(this.id)"></select>
              <select id="filtroJornada" onchange="alCambiarFiltro(this.id)"></select>
              <select id="filtroFecha" onchange="alCambiarFiltro(this.id)"></select>
            </section>
            <div id="contenidoResultados"></div>
            <div id="detalleJornada" class="detalle"></div>
          </div>
          <div
            id="vistaPalmares"
            class="vista-oculta"
          >
            <section class="panel-palmares-filtro">
              <label for="filtroTemporadaPalmares">
                Temporada del palmarés
              </label>
              <select
                id="filtroTemporadaPalmares"
                onchange="renderizarPalmares()"
              ></select>
            </section>
            <div id="contenidoPalmares"></div>
          </div>
        `
        : `
          <div class="sin-resultados">
            Todavía no hay jornadas disponibles.
          </div>
        `
    }
    <footer class="pie">
      <strong>Club Bowling Pin Ocho</strong>
      · Pasión por el bowling desde 2013
    </footer>
  </div>
  <script>
    const jornadas = ${jornadasJson};
    const torneosFinalizados = ${torneosFinalizadosJson};
    const resultadosTorneos = ${resultadosTorneosJson};
    const cronicasResultados = ${cronicasResultadosJson};
    const DIAS_RECIENTES = ${DIAS_RECIENTES};
    function escaparHtml(texto) {
      return String(texto ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
    function valoresUnicos(lista) {
      return [...new Set(
        lista
          .map(valor => String(valor || "").trim())
          .filter(Boolean)
      )];
    }
    function textoLimpio(valor) {
      return String(valor ?? "").trim();
    }
    function normalizarClaveResultado(texto) {
      return String(texto || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
    }
    function obtenerResultadoComplementario(
      eventoCalendario,
      jugador
    ) {
      const eventoClave =
        normalizarClaveResultado(eventoCalendario);
      const jugadorClave =
        normalizarClaveResultado(jugador);
      if (!eventoClave || !jugadorClave) {
        return null;
      }
      return resultadosTorneos.find(dato =>
        normalizarClaveResultado(
          dato.eventoCalendario
        ) === eventoClave &&
        normalizarClaveResultado(
          dato.jugador
        ) === jugadorClave
      ) || null;
    }
    function obtenerObservacionGeneralTorneo(
      eventoCalendario
    ) {
      const eventoClave =
        normalizarClaveResultado(eventoCalendario);
      if (!eventoClave) {
        return "";
      }
      const filaGeneral =
        resultadosTorneos.find(dato =>
          normalizarClaveResultado(
            dato.eventoCalendario
          ) === eventoClave &&
          !normalizarClaveResultado(
            dato.jugador
          )
        );
      return textoLimpio(
        filaGeneral?.observacionesTorneo || ""
      );
    }
    function obtenerCronicasIA(
      eventoCalendario
    ) {
      const clave =
        normalizarClaveResultado(
          eventoCalendario
        );
      if (!clave) {
        return [];
      }
      return cronicasResultados
        .filter(dato => {
          const claveDato =
            normalizarClaveResultado(
              dato.eventoCalendario
            );
          return (
            claveDato === clave ||
            claveDato.startsWith(
              clave + " || "
            )
          );
        })
        .map(dato => {
          const partes =
            String(
              dato.eventoCalendario ||
              ""
            )
              .split("||")
              .map(textoLimpio);
          return {
            cronica:
              textoLimpio(
                dato.cronica ||
                ""
              ),
            equipo:
              partes.length >= 2
                ? partes[1]
                : "",
            competicion:
              partes.length >= 4
                ? partes[2]
                : "",
            jornada:
              partes.length >= 4
                ? partes[3]
                : (
                    partes.length >= 3
                      ? partes[2]
                      : ""
                  )
          };
        })
        .filter(dato => dato.cronica);
    }
    function obtenerCronicaIAJornada(jornada) {
      const cronicas = obtenerCronicasIA(jornada.eventoCalendario);
      if (!cronicas.length) return "";
      if (!jornada.equipoLiga) {
        return cronicas.length === 1 ? cronicas[0].cronica : "";
      }
      const equipo = normalizarClaveResultado(jornada.equipoLiga);
      const division = normalizarClaveResultado(jornada.divisionLiga);
      const porEquipo = cronicas.filter(dato =>
        normalizarClaveResultado(dato.equipo) === equipo
      );
      if (porEquipo.length === 1) {
        return textoLimpio(porEquipo[0].cronica);
      }
      const exacta = porEquipo.find(dato =>
        !division ||
        !dato.competicion ||
        normalizarClaveResultado(dato.competicion) === division
      );
      return textoLimpio(exacta && exacta.cronica);
    }
    function crearBloqueCronicaIA(
      eventoCalendario,
      textoAlternativo = ""
    ) {
      const cronicas =
        obtenerCronicasIA(
          eventoCalendario
        );
      if (!cronicas.length) {
        const alternativa =
          textoLimpio(
            textoAlternativo
          );
        if (!alternativa) {
          return "";
        }
        return \`
          <div class="cronica-torneo">
            <p class="cronica-intro">
              \${escaparHtml(alternativa)}
            </p>
          </div>
        \`;
      }
      return cronicas
        .map(dato => {
          const cabecera =
            dato.equipo
              ? \`
                <div class="cronica-equipo-titulo">
                  \${escaparHtml(
                    dato.equipo +
                    (
                      dato.jornada
                        ? " · " + dato.jornada
                        : ""
                    )
                  )}
                </div>
              \`
              : "";
          return \`
            <div class="cronica-torneo">
              \${cabecera}
              <p class="cronica-intro">
                \${escaparHtml(dato.cronica)}
              </p>
            </div>
          \`;
        })
        .join("");
    }
    function crearMvpMejora(
      resumen
    ) {
      if (
        !resumen ||
        resumen.totalJugadores <= 1
      ) {
        return "";
      }
      const mejora =
        resumen.mayorProgreso;
      if (
        mejora &&
        Number.isFinite(mejora.progreso) &&
        mejora.progreso > 0
      ) {
        return \`
          <div class="premios">
            \${crearPremio(
              "🚀",
              "MVP · Mayor mejora sobre su media",
              mejora,
              signo(mejora.progreso) +
                " bolos sobre su media de temporada",
              true
            )}
          </div>
        \`;
      }
      const mejorPromedio =
        resumen.mejorPromedio;
      if (
        !mejorPromedio ||
        !Number.isFinite(mejorPromedio.promedio)
      ) {
        return "";
      }
      return \`
        <div class="premios">
          \${crearPremio(
            "🏅",
            "MVP · Mejor promedio del equipo",
            mejorPromedio,
            formatearNumero(mejorPromedio.promedio) +
              " de promedio",
            true
          )}
        </div>
      \`;
    }
    function esFaseClasificatoria(fase) {
      return normalizarClaveResultado(fase) ===
        "clasificatoria";
    }
    function textoPuestoFinal(puesto) {
      const numero = Number(puesto);
      if (!Number.isFinite(numero) || numero <= 0) {
        return "";
      }
      return numero + ".º";
    }
    function crearCronicaTorneo(torneo, tituloTorneo) {
      const titulo =
        tituloTorneo ||
        torneo.eventoCalendario ||
        torneo.competicion;
      const observacionGeneral =
        textoLimpio(
          torneo.observacionGeneralTorneo || ""
        );
      const jugadores =
        Array.isArray(torneo.jugadores)
          ? torneo.jugadores
          : [];
      if (!jugadores.length) {
        return "";
      }
      function nombreCompletoNatural(jugador) {
        const nombre = String(
          nombreVisible(jugador) || ""
        ).trim();
        return nombre
          .split(" ")
          .filter(Boolean)
          .map(palabra => {
            const minusculas =
              palabra.toLowerCase();
            return minusculas
              ? minusculas.charAt(0).toUpperCase() +
                minusculas.slice(1)
              : "";
          })
          .join(" ");
      }
      function nombreCortoNatural(jugador) {
        const completo =
          nombreCompletoNatural(jugador);
        const partes =
          completo
            .split(" ")
            .filter(Boolean);
        if (!partes.length) {
          return completo;
        }
        const primero =
          partes[0].toLowerCase();
        if (
          partes.length >= 2 &&
          (
            primero === "jose" ||
            primero === "josé" ||
            primero === "maria" ||
            primero === "maría"
          )
        ) {
          return partes[0] + " " + partes[1];
        }
        return partes[0];
      }
      function cerrarFrase(texto) {
        const limpio =
          String(texto || "").trim();
        if (!limpio) {
          return "";
        }
        const ultimo =
          limpio.charAt(
            limpio.length - 1
          );
        return (
          ultimo === "." ||
          ultimo === "!" ||
          ultimo === "?"
        )
          ? limpio
          : limpio + ".";
      }
      function observacionIndividual(texto) {
        const frase =
          cerrarFrase(texto);
        if (!frase) {
          return "";
        }
        return (
          frase.charAt(0).toLowerCase() +
          frase.slice(1)
        );
      }
      const parrafos = [];
      // =====================================================
      // UN SOLO REPRESENTANTE
      // =====================================================
      if (jugadores.length === 1) {
        const jugador =
          jugadores[0];
        const nombreCompleto =
          nombreCompletoNatural(jugador);
        const nombreCorto =
          nombreCortoNatural(jugador);
        const fases =
          Array.isArray(jugador.fasesDetalle)
            ? jugador.fasesDetalle
            : [];
        const clasificatoria =
          fases.find(fase =>
            esFaseClasificatoria(
              fase.nombre
            )
          );
        const fasesPosteriores =
          fases.filter(fase =>
            !esFaseClasificatoria(
              fase.nombre
            )
          );
        let apertura =
          escaparHtml(nombreCompleto) +
          " fue el representante de Pin Ocho en " +
          escaparHtml(titulo) +
          ". ";
        if (
          clasificatoria &&
          fasesPosteriores.length === 0
        ) {
          apertura +=
            "A lo largo de las " +
            clasificatoria.partidas +
            " partidas de la fase clasificatoria firmó una media de " +
            formatearNumero(
              clasificatoria.promedio
            ) +
            ", con una máxima de " +
            clasificatoria.maxima +
            ".";
        } else {
          apertura +=
            "A lo largo de las " +
            jugador.puntuaciones.length +
            " partidas registradas firmó una media de " +
            formatearNumero(
              jugador.promedio
            ) +
            ", con una máxima de " +
            jugador.maxima +
            ".";
        }
        if (jugador.cantidad200 > 0) {
          apertura +=
            " Sumó " +
            jugador.cantidad200 +
            " partida" +
            (
              jugador.cantidad200 === 1
                ? ""
                : "s"
            ) +
            " de 200 o más.";
        }
        if (observacionGeneral) {
          apertura +=
            " " +
            escaparHtml(
              cerrarFrase(
                observacionGeneral
              )
            );
        }
        parrafos.push(apertura);
        let desarrollo = "";
        if (jugador.observacionesTorneo) {
          desarrollo +=
            escaparHtml(nombreCorto) +
            " " +
            escaparHtml(
              observacionIndividual(
                jugador.observacionesTorneo
              )
            );
        }
        if (fasesPosteriores.length) {
          const recorrido =
            fasesPosteriores
              .map(fase =>
                "en " +
                escaparHtml(
                  fase.nombre
                ) +
                " promedió " +
                formatearNumero(
                  fase.promedio
                ) +
                " y alcanzó una máxima de " +
                fase.maxima
              )
              .join("; ");
          desarrollo +=
            (
              desarrollo
                ? " "
                : escaparHtml(nombreCorto) + " "
            ) +
            "Tras la clasificatoria, " +
            recorrido +
            ".";
        }
        const puesto =
          textoPuestoFinal(
            jugador.puestoFinal
          );
        if (puesto) {
          desarrollo +=
            (
              desarrollo
                ? " "
                : escaparHtml(nombreCorto) + " "
            ) +
            "Terminó el torneo en " +
            puesto +
            ".";
        }
        if (desarrollo) {
          parrafos.push(desarrollo);
        }
      // =====================================================
      // VARIOS REPRESENTANTES
      // =====================================================
      } else {
        const nombres =
          jugadores.map(
            nombreCompletoNatural
          );
        let apertura =
          jugadores.length +
          " jugadores de Pin Ocho participaron en " +
          escaparHtml(titulo) +
          ": " +
          escaparHtml(
            nombres.join(", ")
          ) +
          ". El equipo completó " +
          torneo.totalPartidas +
          " partida" +
          (
            torneo.totalPartidas === 1
              ? ""
              : "s"
          ) +
          ", con una media conjunta de " +
          formatearNumero(
            torneo.mediaGeneral
          ) +
          ".";
        if (torneo.total200 > 0) {
          apertura +=
            " Se registraron " +
            torneo.total200 +
            " partida" +
            (
              torneo.total200 === 1
                ? ""
                : "s"
            ) +
            " de 200 o más.";
        }
        if (observacionGeneral) {
          apertura +=
            " " +
            escaparHtml(
              cerrarFrase(
                observacionGeneral
              )
            );
        }
        parrafos.push(apertura);
        jugadores.forEach(jugador => {
          const nombreCorto =
            nombreCortoNatural(jugador);
          const fases =
            Array.isArray(
              jugador.fasesDetalle
            )
              ? jugador.fasesDetalle
              : [];
          const clasificatoria =
            fases.find(fase =>
              esFaseClasificatoria(
                fase.nombre
              )
            );
          const fasesPosteriores =
            fases.filter(fase =>
              !esFaseClasificatoria(
                fase.nombre
              )
            );
          let texto =
            escaparHtml(nombreCorto) +
            " ";
          if (clasificatoria) {
            texto +=
              "cerró la clasificatoria con " +
              formatearNumero(
                clasificatoria.promedio
              ) +
              " de media en " +
              clasificatoria.partidas +
              " partida" +
              (
                clasificatoria.partidas === 1
                  ? ""
                  : "s"
              ) +
              ", con una máxima de " +
              clasificatoria.maxima +
              ".";
          } else {
            texto +=
              "firmó una media de " +
              formatearNumero(
                jugador.promedio
              ) +
              " en " +
              jugador.puntuaciones.length +
              " partida" +
              (
                jugador.puntuaciones.length === 1
                  ? ""
                  : "s"
              ) +
              ", con una máxima de " +
              jugador.maxima +
              ".";
          }
          if (fasesPosteriores.length) {
            fasesPosteriores.forEach(
              fase => {
                texto +=
                  " En " +
                  escaparHtml(
                    fase.nombre
                  ) +
                  " firmó una media de " +
                  formatearNumero(
                    fase.promedio
                  ) +
                  ", con una máxima de " +
                  fase.maxima +
                  ".";
              }
            );
          }
          const puesto =
            textoPuestoFinal(
              jugador.puestoFinal
            );
          if (puesto) {
            texto +=
              " Finalizó el torneo en " +
              puesto +
              ".";
          }
          if (jugador.observacionesTorneo) {
            texto +=
              " " +
              escaparHtml(nombreCorto) +
              " " +
              escaparHtml(
                observacionIndividual(
                  jugador.observacionesTorneo
                )
              );
          }
          if (
            Number.isFinite(
              Number(jugador.progreso)
            ) &&
            Number(jugador.progreso) >= 12 &&
            jugador.puntuaciones.length >= 3
          ) {
            texto +=
              " Su actuación estuvo claramente por encima de su nivel habitual de la temporada.";
          }
          parrafos.push(texto);
        });
      }
      return (
        '<div class="cronica-torneo">' +
          '<div class="titulo-panel">Crónica del torneo</div>' +
          '<div class="cronica-relato">' +
            parrafos
              .filter(Boolean)
              .map(parrafo =>
                '<p class="cronica-texto">' +
                  parrafo +
                '</p>'
              )
              .join("") +
          '</div>' +
        '</div>'
      );
    }
    function ordenarTemporadas(a, b) {
      const numeroA = Number(String(a).match(/\\d{4}/)?.[0] || 0);
      const numeroB = Number(String(b).match(/\\d{4}/)?.[0] || 0);
      return numeroB - numeroA;
    }
    function formatearFecha(fechaIso) {
      if (!fechaIso) return "";
      const partes = String(fechaIso).split("-");
      if (partes.length !== 3) return fechaIso;
      return new Date(
        Number(partes[0]),
        Number(partes[1]) - 1,
        Number(partes[2])
      ).toLocaleDateString(
        "es-ES",
        {
          day: "numeric",
          month: "long",
          year: "numeric"
        }
      );
    }
    function formatearNumero(valor) {
      return Number(valor || 0).toLocaleString(
        "es-ES",
        {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1
        }
      );
    }
    function nombreVisible(jugador) {
      if (!jugador) return "—";
      return jugador.alias || jugador.nombre || "—";
    }
    function signo(valor) {
      const numero = Number(valor || 0);
      return numero >= 0
        ? "+" + formatearNumero(numero)
        : formatearNumero(numero);
    }
    function textoFase(jornada) {
      const marcas =
        Array.isArray(jornada.marcas)
          ? jornada.marcas
          : [];
      return marcas.length
        ? " · " + escaparHtml(marcas.join(" · "))
        : "";
    }
    const configuracionFiltros = [
      {
        id: "filtroTemporada",
        textoTodos: "Todas las temporadas",
        obtenerValores: jornada =>
          jornada.temporada
            ? [jornada.temporada]
            : [],
        ordenar: lista =>
          lista.sort(ordenarTemporadas),
        mostrar: valor =>
          valor
      },
      {
        id: "filtroCompeticion",
        textoTodos: "Todas las competiciones",
        obtenerValores: jornada =>
          jornada.competicion
            ? [jornada.competicion]
            : [],
        ordenar: lista =>
          lista.sort((a, b) =>
            String(a).localeCompare(
              String(b),
              "es",
              {
                numeric: true,
                sensitivity: "base"
              }
            )
          ),
        mostrar: valor =>
          valor
      },
      {
        id: "filtroJornada",
        textoTodos: "Todas las jornadas",
        obtenerValores: jornada =>
          Array.isArray(jornada.jornadas)
            ? jornada.jornadas
            : [],
        ordenar: lista =>
          lista.sort((a, b) =>
            String(a).localeCompare(
              String(b),
              "es",
              {
                numeric: true,
                sensitivity: "base"
              }
            )
          ),
        mostrar: valor =>
          valor
      },
      {
        id: "filtroFecha",
        textoTodos: "Todas las fechas",
        obtenerValores: jornada =>
          jornada.fechaIso
            ? [jornada.fechaIso]
            : [],
        ordenar: lista =>
          lista.sort((a, b) =>
            String(b).localeCompare(String(a))
          ),
        mostrar: valor =>
          formatearFecha(valor)
      }
    ];
    function obtenerSelecciones() {
      const selecciones = {};
      configuracionFiltros.forEach(filtro => {
        selecciones[filtro.id] =
          document.getElementById(filtro.id).value;
      });
      return selecciones;
    }
    function jornadaTieneValor(
      jornada,
      filtro,
      valor
    ) {
      if (!valor) {
        return true;
      }
      return filtro
        .obtenerValores(jornada)
        .some(disponible =>
          String(disponible) === String(valor)
        );
    }
    function jornadaCumpleSelecciones(
      jornada,
      selecciones,
      idExcluido = ""
    ) {
      return configuracionFiltros.every(filtro => {
        if (filtro.id === idExcluido) {
          return true;
        }
        return jornadaTieneValor(
          jornada,
          filtro,
          selecciones[filtro.id]
        );
      });
    }
    function obtenerValoresDisponibles(
      filtro,
      selecciones
    ) {
      const valores = jornadas
        .filter(jornada =>
          jornadaCumpleSelecciones(
            jornada,
            selecciones,
            filtro.id
          )
        )
        .flatMap(jornada =>
          filtro.obtenerValores(jornada)
        );
      return filtro.ordenar(
        valoresUnicos(valores)
      );
    }
    function cargarSelector(
      filtro,
      valores,
      valorSeleccionado
    ) {
      const selector =
        document.getElementById(filtro.id);
      selector.innerHTML =
        '<option value="">' +
          escaparHtml(filtro.textoTodos) +
        '</option>' +
        valores
          .map(valor =>
            '<option value="' +
              escaparHtml(valor) +
            '">' +
              escaparHtml(filtro.mostrar(valor)) +
            '</option>'
          )
          .join("");
      selector.value =
        valorSeleccionado &&
        valores.includes(valorSeleccionado)
          ? valorSeleccionado
          : "";
    }
    function actualizarFiltrosDependientes(
      idPrioritario = ""
    ) {
      let selecciones =
        obtenerSelecciones();
      let huboCambios = true;
      let vueltas = 0;
      while (
        huboCambios &&
        vueltas < 10
      ) {
        huboCambios = false;
        vueltas += 1;
        configuracionFiltros.forEach(filtro => {
          if (filtro.id === idPrioritario) {
            return;
          }
          const valorActual =
            selecciones[filtro.id];
          if (!valorActual) {
            return;
          }
          const disponibles =
            obtenerValoresDisponibles(
              filtro,
              selecciones
            );
          if (!disponibles.includes(valorActual)) {
            selecciones[filtro.id] = "";
            huboCambios = true;
          }
        });
      }
      configuracionFiltros.forEach(filtro => {
        const disponibles =
          obtenerValoresDisponibles(
            filtro,
            selecciones
          );
        cargarSelector(
          filtro,
          disponibles,
          selecciones[filtro.id]
        );
      });
    }
    function cargarFiltros() {
      configuracionFiltros.forEach(filtro => {
        const selector =
          document.getElementById(filtro.id);
        selector.innerHTML =
          '<option value="">' +
            escaparHtml(filtro.textoTodos) +
          '</option>';
      });
      actualizarFiltrosDependientes();
    }
    function obtenerFiltradas() {
      const selecciones =
        obtenerSelecciones();
      return jornadas.filter(jornada =>
        jornadaCumpleSelecciones(
          jornada,
          selecciones
        )
      );
    }
    function alCambiarFiltro(idFiltro) {
      actualizarFiltrosDependientes(idFiltro);
      aplicarFiltros();
    }
    function claveGrupoInforme(jornada) {
      const evento = normalizarClaveResultado(jornada.eventoCalendario || jornada.jornada || jornada.competicion);
      return [jornada.temporada, jornada.fechaIso, evento, normalizarClaveResultado(jornada.competicion)].join("||");
    }
    function gruposInformesTemporada(temporada) {
      const grupos = new Map();
      jornadas.filter(j => j.temporada === temporada).forEach(j => {
        const clave = claveGrupoInforme(j);
        if (!grupos.has(clave)) grupos.set(clave,{clave,fechaMs:j.fechaMs,fechaIso:j.fechaIso,titulo:j.eventoCalendario || j.jornada || j.competicion,competicion:j.competicion,jornadas:[]});
        grupos.get(clave).jornadas.push(j);
      });
      return [...grupos.values()].sort((a,b)=>b.fechaMs-a.fechaMs || a.titulo.localeCompare(b.titulo,'es'));
    }
    function temporadaPortadaActual() {
      return document.getElementById("filtroTemporada")?.value || "";
    }
    function cargarPortadaInformes() {
      const selector = document.getElementById("filtroTemporada");
      if (!selector) return;
      const temporadas = [...new Set(jornadas.map(j=>j.temporada).filter(Boolean))].sort(ordenarTemporadas);
      const actual = selector.value;
      selector.innerHTML = temporadas.map(t=>'<option value="'+escaparHtml(t)+'">'+escaparHtml(t)+'</option>').join('');
      selector.value = temporadas.includes(actual) ? actual : (temporadas[0] || "");
      cambiarTemporadaPortada();
    }
    function cambiarTemporadaPortada() {
      const grupos = gruposInformesTemporada(temporadaPortadaActual());
      const selector = document.getElementById("selectorInformePortada");
      selector.innerHTML = '<option value="">Seleccionar informe...</option>' + grupos.map((g,i)=>'<option value="'+i+'">'+escaparHtml(g.titulo)+' · '+escaparHtml(formatearFecha(g.fechaIso))+'</option>').join('');
      const tarjetas = document.getElementById("tarjetasInformesPortada");
      tarjetas.innerHTML = grupos.slice(0,9).map((g,i)=>'<button class="tarjeta-informe-portada" onclick="abrirInformePortada('+i+')"><small>🎳 '+escaparHtml(g.competicion)+'</small><strong>'+escaparHtml(g.titulo)+'</strong><div class="tarjeta-pie"><small>'+escaparHtml(formatearFecha(g.fechaIso))+(g.jornadas.length>1?' · '+g.jornadas.length+' equipos':'')+'</small><span>↗</span></div></button>').join('') || '<div class="sin-resultados">No hay informes para esta temporada.</div>';
    }
    function abrirInformeSeleccionado() {
      const valor = document.getElementById("selectorInformePortada").value;
      if (valor !== "") abrirInformePortada(Number(valor));
    }
    function abrirInformePortada(indice) {
      const grupo = gruposInformesTemporada(temporadaPortadaActual())[indice];
      if (!grupo) return;
      document.getElementById("portadaResultados").classList.add("vista-oculta");
      document.getElementById("barraVolverResultados").classList.remove("vista-oculta");
      document.getElementById("panelBuscadorResultados").classList.add("vista-oculta");
      cerrarDetalle();
      document.getElementById("contenidoResultados").innerHTML = grupo.jornadas.map(j=>crearJornadaPrincipal(j,false)).join("");
      window.scrollTo({top:0,behavior:"smooth"});
    }
    function mostrarPortadaResultados() {
      document
        .getElementById("portadaResultados")
        .classList.remove("vista-oculta");
      document
        .getElementById("barraVolverResultados")
        .classList.add("vista-oculta");
      document
        .getElementById("panelBuscadorResultados")
        .classList.add("vista-oculta");
      document.getElementById("contenidoResultados").innerHTML = "";
      cerrarDetalle();
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    }
    function abrirOpcionResultados(opcion) {
      document
        .getElementById("portadaResultados")
        .classList.add("vista-oculta");
      document
        .getElementById("barraVolverResultados")
        .classList.remove("vista-oculta");
      document
        .getElementById("panelBuscadorResultados")
        .classList.toggle(
          "vista-oculta",
          opcion !== "buscar"
        );
      cerrarDetalle();
      if (opcion === "ultima-jornada") {
        renderizarSoloUltimaJornada();
      } else if (opcion === "ultimo-torneo") {
        renderizarUltimoTorneoFinalizado();
      } else {
        aplicarFiltros();
      }
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    }
    function renderizarSoloUltimaJornada() {
      const contenedor =
        document.getElementById("contenidoResultados");
      if (!jornadas.length) {
        contenedor.innerHTML =
          '<div class="sin-resultados">' +
          'No hay jornadas disponibles.' +
          '</div>';
        return;
      }
      const ultima = jornadas[0];
      const grupo = jornadas.filter(jornada =>
        jornada.fechaIso === ultima.fechaIso &&
        normalizarClaveResultado(jornada.eventoCalendario) ===
          normalizarClaveResultado(ultima.eventoCalendario) &&
        normalizarClaveResultado(jornada.jornada) ===
          normalizarClaveResultado(ultima.jornada)
      );
      contenedor.innerHTML = grupo
        .map((jornada, indice) => crearJornadaPrincipal(jornada, indice === 0))
        .join("");
    }
    function renderizarUltimoTorneoFinalizado() {
      const contenedor =
        document.getElementById("contenidoResultados");
      if (!torneosFinalizados.length) {
        contenedor.innerHTML =
          '<div class="sin-resultados">' +
          'Todavía no hay ningún torneo o evento finalizado con resultados disponibles.' +
          '</div>';
        return;
      }
      const torneo = torneosFinalizados[0];
      const listaTorneo =
        obtenerJornadasTorneoFinalizado(torneo);
      if (!listaTorneo.length) {
        contenedor.innerHTML =
          '<div class="sin-resultados">' +
          'No se han encontrado partidas asociadas al último torneo finalizado.' +
          '</div>';
        return;
      }
      renderizarResumenTorneo(
        listaTorneo,
        {
          filtroCompeticion: torneo.competicion,
          filtroTemporada: torneo.temporada,
          eventoCalendario: torneo.tituloCalendario,
          tituloTorneo: torneo.tituloCalendario
        }
      );
    }
    let vistaActual =
      "resultados";
    function cambiarVista(vista) {
      vistaActual = vista;
      const esResultados =
        vista === "resultados";
      document
        .getElementById("vistaResultados")
        .classList.toggle(
          "vista-oculta",
          !esResultados
        );
      document
        .getElementById("vistaPalmares")
        .classList.toggle(
          "vista-oculta",
          esResultados
        );
      document
        .getElementById("pestanaResultados")
        .classList.toggle(
          "activa",
          esResultados
        );
      document
        .getElementById("pestanaPalmares")
        .classList.toggle(
          "activa",
          !esResultados
        );
      if (!esResultados) {
        renderizarPalmares();
      } else {
        mostrarPortadaResultados();
      }
    }
    function cargarTemporadasPalmares() {
      const selector =
        document.getElementById(
          "filtroTemporadaPalmares"
        );
      const temporadas =
        valoresUnicos(
          jornadas.map(evento =>
            evento.temporada
          )
        ).sort(ordenarTemporadas);
      selector.innerHTML =
        temporadas
          .map(temporada =>
            '<option value="' +
              escaparHtml(temporada) +
            '">' +
              escaparHtml(temporada) +
            '</option>'
          )
          .join("");
      const temporadaResultados =
        document
          .getElementById("filtroTemporada")
          .value;
      selector.value =
        temporadaResultados &&
        temporadas.includes(
          temporadaResultados
        )
          ? temporadaResultados
          : (
              temporadas[0] || ""
            );
    }
    function obtenerGanadoresMensuales(
      temporada
    ) {
      const eventosTemporada =
        jornadas
          .filter(evento =>
            evento.temporada === temporada
          )
          .sort((a, b) =>
            a.fechaMs - b.fechaMs
          );
      const meses =
        new Map();
      eventosTemporada.forEach(evento => {
        const fecha =
          new Date(evento.fechaMs);
        const claveMes =
          fecha.getFullYear() +
          "-" +
          String(
            fecha.getMonth() + 1
          ).padStart(2, "0");
        if (!meses.has(claveMes)) {
          meses.set(claveMes, []);
        }
        meses.get(claveMes).push(evento);
      });
      return [...meses.entries()]
        .sort((a, b) =>
          a[0].localeCompare(b[0])
        )
        .map(([claveMes, eventosMes]) => {
          const [anioTexto, mesTextoNumero] =
            claveMes.split("-");
          const inicioMes =
            new Date(
              Number(anioTexto),
              Number(mesTextoNumero) - 1,
              1
            );
          const inicioVentana =
            new Date(
              inicioMes.getFullYear() - 1,
              inicioMes.getMonth(),
              1
            ).getTime();
          const finVentana =
            inicioMes.getTime();
          /*
            Referencia: todas las partidas del jugador
            durante los 12 meses anteriores al mes evaluado.
          */
          const eventosReferencia =
            jornadas.filter(evento =>
              evento.fechaMs >= inicioVentana &&
              evento.fechaMs < finVentana
            );
          const acumuladoReferencia =
            new Map();
          eventosReferencia.forEach(evento => {
            evento.jugadores.forEach(jugador => {
              if (
                !acumuladoReferencia.has(
                  jugador.nombre
                )
              ) {
                acumuladoReferencia.set(
                  jugador.nombre,
                  {
                    total: 0,
                    partidas: 0
                  }
                );
              }
              const dato =
                acumuladoReferencia.get(
                  jugador.nombre
                );
              jugador.puntuaciones.forEach(
                puntuacion => {
                  dato.total +=
                    Number(puntuacion || 0);
                  dato.partidas += 1;
                }
              );
            });
          });
          /*
            Mes: todas las partidas del jugador en
            todas las competiciones y fechas del mes.
          */
          const acumuladoMes =
            new Map();
          eventosMes.forEach(evento => {
            evento.jugadores.forEach(jugador => {
              if (
                !acumuladoMes.has(
                  jugador.nombre
                )
              ) {
                acumuladoMes.set(
                  jugador.nombre,
                  {
                    nombre:
                      jugador.nombre,
                    alias:
                      jugador.alias,
                    foto:
                      jugador.foto,
                    total: 0,
                    partidas: 0,
                    participaciones:
                      0,
                    competiciones:
                      new Set(),
                    fechas:
                      new Set()
                  }
                );
              }
              const dato =
                acumuladoMes.get(
                  jugador.nombre
                );
              jugador.puntuaciones.forEach(
                puntuacion => {
                  dato.total +=
                    Number(puntuacion || 0);
                  dato.partidas += 1;
                }
              );
              dato.participaciones += 1;
              dato.competiciones.add(
                evento.competicion
              );
              dato.fechas.add(
                evento.fechaIso
              );
            });
          });
          const candidatos =
            [...acumuladoMes.values()]
              .filter(jugador => {
                const referencia =
                  acumuladoReferencia.get(
                    jugador.nombre
                  );
                return (
                  jugador.partidas >= 3 &&
                  referencia &&
                  referencia.partidas >= 3
                );
              })
              .map(jugador => {
                const referencia =
                  acumuladoReferencia.get(
                    jugador.nombre
                  );
                const promedioMes =
                  jugador.total /
                  jugador.partidas;
                const mediaReferencia =
                  referencia.total /
                  referencia.partidas;
                return {
                  ...jugador,
                  promedioMes,
                  mediaBase:
                    mediaReferencia,
                  mejora:
                    promedioMes -
                    mediaReferencia,
                  partidasBase:
                    referencia.partidas,
                  numeroCompeticiones:
                    jugador.competiciones.size,
                  numeroFechas:
                    jugador.fechas.size
                };
              })
              .sort((a, b) =>
                b.mejora - a.mejora ||
                b.promedioMes -
                  a.promedioMes ||
                b.partidas - a.partidas
              );
          const nombreMes =
            inicioMes.toLocaleDateString(
              "es-ES",
              {
                month: "long",
                year: "numeric"
              }
            );
          return {
            claveMes,
            mesTexto:
              nombreMes,
            ganador:
              candidatos[0] || null,
            totalEventos:
              eventosMes.length
          };
        });
    }
    function crearMesCard(mes) {
      if (!mes.ganador) {
        return \`
          <article class="mes-card">
            <div class="mes-card-titulo">
              \${escaparHtml(mes.mesTexto)}
            </div>
            <div class="mes-card-detalle">
              Sin jugadores con al menos 3 partidas
              durante el mes y 3 partidas en los
              12 meses anteriores.
            </div>
          </article>
        \`;
      }
      return \`
        <article class="mes-card">
          <div class="mes-card-titulo">
            \${escaparHtml(mes.mesTexto)}
          </div>
          <div class="mes-card-jugador">
            \${escaparHtml(
              nombreVisible(mes.ganador)
            )}
          </div>
          <div class="mes-card-mejora">
            \${signo(
              mes.ganador.mejora
            )}
            bolos
          </div>
          <div class="mes-card-detalle">
            Promedio de todas las partidas del mes:
            <strong>
              \${formatearNumero(
                mes.ganador.promedioMes
              )}
            </strong>
            ·
            \${mes.ganador.partidas}
            partidas en
            \${mes.ganador.numeroFechas}
            fecha\${mes.ganador.numeroFechas === 1 ? "" : "s"}
            · Media de los 12 meses anteriores:
            \${formatearNumero(
              mes.ganador.mediaBase
            )}
            (\${mes.ganador.partidasBase} partidas)
          </div>
        </article>
      \`;
    }
    function renderizarPalmares() {
      const selector =
        document.getElementById(
          "filtroTemporadaPalmares"
        );
      const temporada =
        selector.value;
      const lista =
        jornadas.filter(evento =>
          evento.temporada === temporada
        );
      const contenido =
        document.getElementById(
          "contenidoPalmares"
        );
      if (!lista.length) {
        contenido.innerHTML = \`
          <div class="sin-resultados">
            No hay datos para esta temporada.
          </div>
        \`;
        return;
      }
      const meses =
        obtenerGanadoresMensuales(
          temporada
        );
      contenido.innerHTML = \`
        \${crearBloquePalmares(lista)}
        <section class="seccion">
          <div class="cabecera-seccion">
            <h2>Jugadores del mes</h2>
            <p>
              Mayor mejora frente a los 12 meses anteriores
            </p>
          </div>
          <div class="meses-grid">
            \${meses
              .map(crearMesCard)
              .join("")
            }
          </div>
        </section>
      \`;
    }
    function aplicarFiltros() {
      cerrarDetalle();
      const selecciones =
        obtenerSelecciones();
      const lista =
        jornadas.filter(jornada =>
          jornadaCumpleSelecciones(
            jornada,
            selecciones
          )
        );
      const sinDetalle =
        !selecciones.filtroJornada &&
        !selecciones.filtroFecha;
      const modoTorneo =
        Boolean(selecciones.filtroCompeticion) &&
        sinDetalle;
      const modoTemporada =
        Boolean(selecciones.filtroTemporada) &&
        !selecciones.filtroCompeticion &&
        sinDetalle;
      if (modoTorneo) {
        renderizarResumenTorneo(
          lista,
          selecciones
        );
      } else if (modoTemporada) {
        renderizarResumenTemporada(
          lista,
          selecciones
        );
      } else {
        renderizarResultados(
          lista,
          selecciones
        );
      }
    }
    function crearPremio(
      icono,
      etiqueta,
      jugador,
      valor,
      destacado = false,
      ocultarNombre = false
    ) {
      if (!jugador) return "";
      return \`
        <article class="premio \${destacado ? "premio-destacado" : ""}">
          <div class="premio-icono">\${icono}</div>
          <div class="premio-etiqueta">\${escaparHtml(etiqueta)}</div>
          \${ocultarNombre
            ? ""
            : \`
                <div class="premio-nombre">
                  \${escaparHtml(nombreVisible(jugador))}
                </div>
              \`
          }
          <div class="premio-valor">
            \${escaparHtml(valor)}
          </div>
        </article>
      \`;
    }
    function crearInformeIndividual(jornada) {
      const jugador = jornada.jugadores[0];
      if (!jugador) {
        return "";
      }
      const partidasHtml = jugador.partidasOrdenadas
        .map(partida => \`
          <div class="partida-individual">
            <small>P\${escaparHtml(partida.numero)}</small>
            <strong>\${escaparHtml(partida.puntuacion)}</strong>
          </div>
        \`)
        .join("");
      return \`
        <div class="informe-individual">
          <div class="individual-cabecera">
            <div class="individual-icono">🎳</div>
            <div>
              <div class="individual-nombre">
                \${escaparHtml(nombreVisible(jugador))}
              </div>
              <div class="individual-texto">
                Participación individual ·
                \${jugador.puntuaciones.length}
                partida\${jugador.puntuaciones.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <div class="individual-datos">
            <div class="individual-dato">
              <strong>\${formatearNumero(jugador.promedio)}</strong>
              <span>Promedio</span>
            </div>
            <div class="individual-dato">
              <strong>\${jugador.maxima}</strong>
              <span>Mejor partida</span>
            </div>
            <div class="individual-dato">
              <strong>\${jugador.total}</strong>
              <span>Total de bolos</span>
            </div>
            <div class="individual-dato">
              <strong>\${jugador.cantidad200}</strong>
              <span>Partidas de 200+</span>
            </div>
          </div>
          <div class="partidas-individuales">
            \${partidasHtml}
          </div>
          \${crearBloqueCuriosidades(jornada)}
        </div>
      \`;
    }
    function obtenerEventosPreviosMismaTemporada(
      jornada
    ) {
      return jornadas
        .filter(evento =>
          evento.temporada === jornada.temporada &&
          evento.fechaMs < jornada.fechaMs
        )
        .sort((a, b) =>
          a.fechaMs - b.fechaMs
        );
    }
    function obtenerHistorialJugadorAntes(
      jugador,
      jornada
    ) {
      return jornadas
        .filter(evento =>
          evento.fechaMs < jornada.fechaMs
        )
        .flatMap(evento =>
          evento.jugadores
            .filter(item =>
              item.nombre === jugador.nombre
            )
            .flatMap(item =>
              item.puntuaciones
            )
        );
    }
    function obtenerHistorialJugadorTemporadaAntes(
      jugador,
      jornada
    ) {
      return jornadas
        .filter(evento =>
          evento.temporada === jornada.temporada &&
          evento.fechaMs < jornada.fechaMs
        )
        .flatMap(evento =>
          evento.jugadores
            .filter(item =>
              item.nombre === jugador.nombre
            )
            .flatMap(item =>
              item.puntuaciones
            )
        );
    }
    function detectarCuriosidadesJornada(
      jornada
    ) {
      const candidatos = [];
      const eventosPrevios =
        obtenerEventosPreviosMismaTemporada(
          jornada
        );
      const puntuacionesJornada =
        jornada.jugadores.flatMap(
          jugador =>
            jugador.puntuaciones
        );
      const agregar = (
        prioridad,
        icono,
        texto,
        clave
      ) => {
        if (!texto) {
          return;
        }
        candidatos.push({
          prioridad,
          icono,
          texto,
          clave
        });
      };
      /*
        1. Récord personal absoluto de partida.
      */
      jornada.jugadores.forEach(jugador => {
        const historial =
          obtenerHistorialJugadorAntes(
            jugador,
            jornada
          );
        const maximaAnterior =
          historial.length
            ? Math.max(...historial)
            : null;
        if (
          maximaAnterior !== null &&
          jugador.maxima > maximaAnterior
        ) {
          agregar(
            100,
            "🏆",
            "<strong>" +
              escaparHtml(nombreVisible(jugador)) +
            "</strong> firma su mejor partida histórica con " +
              jugador.maxima +
            " bolos.",
            "record-personal-" + jugador.nombre
          );
        }
      });
      /*
        2. Primera partida de 250+.
      */
      jornada.jugadores.forEach(jugador => {
        const historial =
          obtenerHistorialJugadorAntes(
            jugador,
            jornada
          );
        if (
          jugador.maxima >= 250 &&
          !historial.some(valor => valor >= 250)
        ) {
          agregar(
            98,
            "🔥",
            "<strong>" +
              escaparHtml(nombreVisible(jugador)) +
            "</strong> supera por primera vez los 250 bolos.",
            "primer-250-" + jugador.nombre
          );
        }
      });
      /*
        3. Primer 200 de la temporada.
      */
      jornada.jugadores.forEach(jugador => {
        const historial =
          obtenerHistorialJugadorTemporadaAntes(
            jugador,
            jornada
          );
        if (
          jugador.maxima >= 200 &&
          !historial.some(valor => valor >= 200)
        ) {
          agregar(
            94,
            "🎉",
            "<strong>" +
              escaparHtml(nombreVisible(jugador)) +
            "</strong> consigue su primer 200 de la temporada con " +
              jugador.maxima +
            " bolos.",
            "primer-200-temporada-" + jugador.nombre
          );
        }
      });
      /*
        4. Primer 220 de la temporada.
      */
      jornada.jugadores.forEach(jugador => {
        const historial =
          obtenerHistorialJugadorTemporadaAntes(
            jugador,
            jornada
          );
        if (
          jugador.maxima >= 220 &&
          !historial.some(valor => valor >= 220)
        ) {
          agregar(
            92,
            "🚀",
            "<strong>" +
              escaparHtml(nombreVisible(jugador)) +
            "</strong> rompe por primera vez esta temporada la barrera de 220.",
            "primer-220-temporada-" + jugador.nombre
          );
        }
      });
      /*
        5. Mejor promedio individual de la temporada.
      */
      jornada.jugadores.forEach(jugador => {
        const mediasPrevias =
          eventosPrevios
            .flatMap(evento =>
              evento.jugadores
                .filter(item =>
                  item.nombre === jugador.nombre
                )
                .map(item =>
                  item.promedio
                )
            );
        const mejorAnterior =
          mediasPrevias.length
            ? Math.max(...mediasPrevias)
            : null;
        if (
          mejorAnterior !== null &&
          jugador.promedio > mejorAnterior
        ) {
          agregar(
            90,
            "📈",
            "<strong>" +
              escaparHtml(nombreVisible(jugador)) +
            "</strong> logra su mejor promedio de la temporada: " +
              formatearNumero(jugador.promedio) +
            ".",
            "mejor-promedio-temporada-" + jugador.nombre
          );
        }
      });
      /*
        6. Mejor media colectiva de la temporada.
      */
      const mejorMediaEquipoAnterior =
        eventosPrevios.length
          ? Math.max(
              ...eventosPrevios.map(
                evento =>
                  evento.mediaEquipo
              )
            )
          : null;
      if (
        mejorMediaEquipoAnterior !== null &&
        jornada.mediaEquipo >
          mejorMediaEquipoAnterior
      ) {
        agregar(
          89,
          "👥",
          "Pin Ocho firma su mejor media colectiva de la temporada: <strong>" +
            formatearNumero(jornada.mediaEquipo) +
          "</strong>.",
          "mejor-media-equipo-temporada"
        );
      }
      /*
        7. Jornada con más partidas de 200+.
      */
      const max200Anterior =
        eventosPrevios.length
          ? Math.max(
              ...eventosPrevios.map(
                evento =>
                  evento.total200
              )
            )
          : null;
      if (
        max200Anterior !== null &&
        jornada.total200 > max200Anterior &&
        jornada.total200 > 0
      ) {
        agregar(
          87,
          "🔥",
          "Es la jornada con más partidas de 200+ de la temporada: <strong>" +
            jornada.total200 +
          "</strong>.",
          "record-200-equipo-temporada"
        );
      }
      /*
        8. Todos por encima de 180.
      */
      if (
        jornada.totalJugadores >= 2 &&
        jornada.jugadores.every(
          jugador =>
            jugador.promedio >= 180
        )
      ) {
        agregar(
          84,
          "💪",
          "Todos los participantes de Pin Ocho terminan la jornada por encima de 180 de promedio.",
          "todos-180"
        );
      }
      /*
        9. Todos por encima de su media habitual.
      */
      if (
        jornada.totalJugadores >= 2 &&
        jornada.jugadores.every(
          jugador =>
            jugador.progreso > 0
        )
      ) {
        agregar(
          83,
          "📊",
          "Todos los jugadores superan su promedio habitual en esta jornada.",
          "todos-mejoran"
        );
      }
      /*
        10. Ninguna partida por debajo de 170.
      */
      if (
        puntuacionesJornada.length >= 4 &&
        Math.min(...puntuacionesJornada) >= 170
      ) {
        agregar(
          82,
          "🧱",
          "Ninguna partida de Pin Ocho baja de 170 bolos.",
          "ninguna-bajo-170"
        );
      }
      /*
        11. Empate en el mejor promedio.
      */
      if (jornada.jugadores.length >= 2) {
        const mejor =
          jornada.jugadores[0]?.promedio;
        const empatados =
          jornada.jugadores.filter(
            jugador =>
              Math.abs(
                jugador.promedio - mejor
              ) < 0.05
          );
        if (empatados.length >= 2) {
          agregar(
            81,
            "⚖️",
            "Empate en cabeza entre <strong>" +
              empatados
                .map(nombreVisible)
                .map(escaparHtml)
                .join("</strong> y <strong>") +
            "</strong>.",
            "empate-cabeza"
          );
        }
      }
      /*
        12. Máxima igualdad entre jugadores.
      */
      if (jornada.jugadores.length >= 3) {
        const promedios =
          jornada.jugadores.map(
            jugador =>
              jugador.promedio
          );
        const diferencia =
          Math.max(...promedios) -
          Math.min(...promedios);
        if (diferencia <= 10) {
          agregar(
            78,
            "🤝",
            "Solo <strong>" +
              formatearNumero(diferencia) +
            "</strong> bolos separan al mejor y al peor promedio del equipo.",
            "gran-igualdad"
          );
        }
      }
      /*
        13. Tres o más 200 de un mismo jugador.
      */
      jornada.jugadores.forEach(jugador => {
        if (jugador.cantidad200 >= 3) {
          agregar(
            77,
            "💥",
            "<strong>" +
              escaparHtml(nombreVisible(jugador)) +
            "</strong> suma " +
              jugador.cantidad200 +
            " partidas de 200+ en la misma jornada.",
            "tres-200-" + jugador.nombre
          );
        }
      });
      /*
        14. Serie sin bajar de 190.
      */
      jornada.jugadores.forEach(jugador => {
        if (
          jugador.puntuaciones.length >= 3 &&
          Math.min(...jugador.puntuaciones) >= 190
        ) {
          agregar(
            76,
            "🎯",
            "<strong>" +
              escaparHtml(nombreVisible(jugador)) +
            "</strong> completa toda la serie sin bajar de 190.",
            "serie-190-" + jugador.nombre
          );
        }
      });
      /*
        15. Segunda vuelta especialmente fuerte.
      */
      jornada.jugadores.forEach(jugador => {
        if (
          jugador.mejoraSegundaVuelta !== null &&
          jugador.mejoraSegundaVuelta >= 20
        ) {
          agregar(
            75,
            "🏁",
            "<strong>" +
              escaparHtml(nombreVisible(jugador)) +
            "</strong> mejora " +
              formatearNumero(
                jugador.mejoraSegundaVuelta
              ) +
            " bolos en la segunda vuelta.",
            "segunda-vuelta-" + jugador.nombre
          );
        }
      });
      /*
        16. Montaña rusa extrema.
      */
      jornada.jugadores.forEach(jugador => {
        if (
          jugador.puntuaciones.length >= 3 &&
          jugador.rango >= 70
        ) {
          agregar(
            64,
            "🎢",
            "<strong>" +
              escaparHtml(nombreVisible(jugador)) +
            "</strong> vive una montaña rusa de " +
              jugador.rango +
            " bolos entre su mejor y peor partida.",
            "montana-rusa-" + jugador.nombre
          );
        }
      });
      /*
        17. Partida muy alta del equipo.
      */
      if (
        jornada.mejorPartida &&
        jornada.mejorPartida.maxima >= 240
      ) {
        agregar(
          74,
          "⚡",
          "<strong>" +
            escaparHtml(
              nombreVisible(
                jornada.mejorPartida
              )
            ) +
          "</strong> firma una partida de " +
            jornada.mejorPartida.maxima +
          " bolos.",
          "partida-240"
        );
      }
      /*
        18. Jornada por encima de 190 de media.
      */
      if (jornada.mediaEquipo >= 190) {
        agregar(
          73,
          "🌟",
          "Pin Ocho supera los 190 de media colectiva con <strong>" +
            formatearNumero(jornada.mediaEquipo) +
          "</strong>.",
          "equipo-190"
        );
      }
      /*
        Evitamos duplicados conceptuales y mostramos
        las 3 historias con mayor prioridad.
      */
      const vistas =
        new Set();
      return candidatos
        .sort((a, b) =>
          b.prioridad - a.prioridad
        )
        .filter(item => {
          if (vistas.has(item.clave)) {
            return false;
          }
          vistas.add(item.clave);
          return true;
        })
        .slice(0, 3);
    }
    function crearBloqueCuriosidades(
      jornada
    ) {
      const curiosidades =
        detectarCuriosidadesJornada(
          jornada
        );
      if (!curiosidades.length) {
        return "";
      }
      return \`
        <div class="curiosidades">
          <div class="curiosidades-titulo">
            Historias de la jornada
          </div>
          <div class="curiosidades-lista">
            \${curiosidades
              .map(curiosidad => \`
                <div class="curiosidad">
                  <div class="curiosidad-icono">
                    \${curiosidad.icono}
                  </div>
                  <div class="curiosidad-texto">
                    \${curiosidad.texto}
                  </div>
                </div>
              \`)
              .join("")
            }
          </div>
        </div>
      \`;
    }
    function crearJornadaPrincipal(jornada, mostrarCabecera = true) {
      const participantes =
        jornada.jugadores
          .map(jugador =>
            nombreVisible(jugador)
          )
          .join(", ");
      const tituloPrincipal =
        jornada.equipoLiga
          ? [
              jornada.eventoCalendario || jornada.jornada,
              jornada.equipoLiga,
              jornada.divisionLiga
            ].filter(Boolean).join(" · ")
          : (
              jornada.eventoCalendario ||
              (
                jornada.marcas &&
                jornada.marcas.length
                  ? jornada.marcas.join(" · ")
                  : jornada.competicion
              )
            );
      const cronica = obtenerCronicaIAJornada(jornada);
      const cronicaHtml =
        cronica
          ? \`
              <div class="cronica-torneo">
                <p class="cronica-intro">
                  \${escaparHtml(cronica)}
                </p>
              </div>
            \`
          : "";
      return \`
        <section class="seccion">
          \${mostrarCabecera ? \`
          <div class="cabecera-seccion">
            <h2>Última jornada</h2>
            <p>La más reciente dentro de los filtros seleccionados</p>
          </div>\` : ""}
          <article class="jornada-principal">
            <div class="portada-jornada">
              <div class="linea-superior">
                <span class="insignia">
                  \${escaparHtml(jornada.competicion)}
                </span>
                <span class="meta">
                  \${escaparHtml(
                    formatearFecha(
                      jornada.fechaIso
                    )
                  )}
                </span>
              </div>
              <h2>
                \${escaparHtml(
                  tituloPrincipal
                )}
              </h2>
              <div class="subtitulo-jornada">
                \${jornada.bolera
                  ? escaparHtml(
                      jornada.bolera
                    )
                  : "Resultados de Pin Ocho"
                }
              </div>
              \${jornada.totalJugadores > 1
                ? \`
                    <div class="participantes-jornada">
                      <strong>Participantes de Pin Ocho:</strong>
                      \${escaparHtml(participantes)}
                    </div>
                  \`
                : ""
              }
            </div>
            \${cronicaHtml}
            \${crearMvpMejora(
              jornada
            )}
            <div class="acciones-jornada">
              <button
                class="boton"
                onclick="abrirDetalle('\${escaparHtml(jornada.id)}')"
              >
                Ver resultados completos
              </button>
            </div>
          </article>
        </section>
      \`;
    }
    function crearTarjetaJornada(jornada) {
      return \`
        <article class="tarjeta-jornada">
          <div>
            <span class="insignia">
              \${escaparHtml(jornada.competicion)}
            </span>
            <h3>
              \${jornada.marcas && jornada.marcas.length
                ? escaparHtml(jornada.marcas.join(" · "))
                : "Resultados"
              }
            </h3>
            <div class="tarjeta-meta">
              \${escaparHtml(formatearFecha(jornada.fechaIso))}
              \${jornada.bolera
                ? "<br>" + escaparHtml(jornada.bolera)
                : ""
              }
            </div>
            <div class="mini-destacado">
              <span>
                \${jornada.totalJugadores === 1
                  ? "Participación individual"
                  : "MVP"
                }
              </span>
              <strong>
                \${escaparHtml(nombreVisible(jornada.mejorPromedio))}
                ·
                \${formatearNumero(jornada.mejorPromedio?.promedio)}
              </strong>
            </div>
          </div>
          <div class="tarjeta-acciones">
            <button
              class="boton-secundario"
              onclick="abrirDetalle('\${escaparHtml(jornada.id)}')"
            >
              Ver jornada
            </button>
          </div>
        </article>
      \`;
    }
    function construirResumenTorneo(
      lista,
      selecciones
    ) {
      const jugadoresMap = new Map();
      const eventosOrdenados =
        [...lista].sort((a, b) =>
          a.fechaMs - b.fechaMs
        );
      eventosOrdenados.forEach(evento => {
        evento.jugadores.forEach(jugadorEvento => {
          const clave =
            jugadorEvento.nombre;
          if (!jugadoresMap.has(clave)) {
            jugadoresMap.set(clave, {
              nombre:
                jugadorEvento.nombre,
              alias:
                jugadorEvento.alias,
              foto:
                jugadorEvento.foto,
              puntuaciones:
                [],
              mediaTemporada:
                Number(
                  jugadorEvento.mediaTemporada ||
                  0
                ),
              apariciones:
                0,
              jornadas:
                new Set(),
              fasesMap:
                new Map()
            });
          }
          const jugador =
            jugadoresMap.get(clave);
          jugador.puntuaciones.push(
            ...jugadorEvento.puntuaciones
          );
          if (
            !jugador.mediaTemporada &&
            jugadorEvento.mediaTemporada
          ) {
            jugador.mediaTemporada =
              Number(
                jugadorEvento.mediaTemporada
              );
          }
          jugador.apariciones += 1;
          jugador.jornadas.add(
            evento.fechaIso +
            "||" +
            (
              evento.jornadas &&
              evento.jornadas.length
                ? evento.jornadas.join(" · ")
                : "Resultados"
            )
          );
          const fasesJugador =
            Array.isArray(
              jugadorEvento.fasesDetalle
            )
              ? jugadorEvento.fasesDetalle
              : [];
          fasesJugador.forEach(fase => {
            if (!jugador.fasesMap.has(fase.nombre)) {
              jugador.fasesMap.set(
                fase.nombre,
                []
              );
            }
            const puntuacionesFase =
              evento.partidas
                .filter(partida =>
                  partida.jugador ===
                    jugadorEvento.nombre &&
                  textoLimpio(partida.fase || "Sin fase") ===
                    fase.nombre
                )
                .map(partida =>
                  Number(partida.puntuacion)
                )
                .filter(Number.isFinite);
            jugador.fasesMap
              .get(fase.nombre)
              .push(...puntuacionesFase);
          });
        });
      });
      const eventosCalendarioTorneo =
        valoresUnicos(
          lista.flatMap(evento =>
            Array.isArray(evento.eventosCalendario)
              ? evento.eventosCalendario
              : [evento.eventoCalendario]
          )
        );
      const eventoCalendario =
        selecciones.eventoCalendario ||
        (
          eventosCalendarioTorneo.length === 1
            ? eventosCalendarioTorneo[0]
            : ""
        );
      const observacionGeneralTorneo =
        obtenerObservacionGeneralTorneo(
          eventoCalendario
        );
      const jugadores =
        [...jugadoresMap.values()]
          .map(jugador => {
            const total =
              jugador.puntuaciones.reduce(
                (suma, valor) =>
                  suma + Number(valor || 0),
                0
              );
            const promedio =
              jugador.puntuaciones.length
                ? total /
                  jugador.puntuaciones.length
                : 0;
            const maxima =
              jugador.puntuaciones.length
                ? Math.max(
                    ...jugador.puntuaciones
                  )
                : 0;
            const minima =
              jugador.puntuaciones.length
                ? Math.min(
                    ...jugador.puntuaciones
                  )
                : 0;
            const rango =
              maxima - minima;
            const cantidad200 =
              jugador.puntuaciones.filter(
                valor =>
                  Number(valor) >= 200
              ).length;
            const progreso =
              promedio -
              (
                jugador.mediaTemporada ||
                promedio
              );
            const fasesDetalle =
              [...jugador.fasesMap.entries()]
                .map(([nombre, puntuaciones]) => {
                  const totalFase =
                    puntuaciones.reduce(
                      (suma, valor) =>
                        suma + Number(valor || 0),
                      0
                    );
                  return {
                    nombre,
                    partidas:
                      puntuaciones.length,
                    total:
                      totalFase,
                    promedio:
                      puntuaciones.length
                        ? totalFase /
                          puntuaciones.length
                        : 0,
                    maxima:
                      puntuaciones.length
                        ? Math.max(
                            ...puntuaciones
                          )
                        : 0
                  };
                });
            const complementario =
              obtenerResultadoComplementario(
                eventoCalendario,
                jugador.nombre
              );
            return {
              ...jugador,
              fasesMap: undefined,
              fasesDetalle,
              puestoFinal:
                complementario?.puestoFinal ??
                "",
              observacionesTorneo:
                complementario?.observacionesTorneo ||
                "",
              total,
              promedio,
              maxima,
              minima,
              rango,
              cantidad200,
              progreso,
              numeroJornadas:
                jugador.jornadas.size
            };
          })
          .sort((a, b) =>
            b.promedio - a.promedio ||
            b.maxima - a.maxima ||
            String(a.nombre).localeCompare(
              String(b.nombre),
              "es"
            )
          );
      const todasPuntuaciones =
        jugadores.flatMap(
          jugador =>
            jugador.puntuaciones
        );
      const mejorPromedio =
        jugadores[0] || null;
      const mejorPartida =
        [...jugadores].sort((a, b) =>
          b.maxima - a.maxima ||
          b.promedio - a.promedio
        )[0] || null;
      const mayorProgreso =
        [...jugadores].sort((a, b) =>
          b.progreso - a.progreso ||
          b.promedio - a.promedio
        )[0] || null;
      const masRegular =
        [...jugadores]
          .filter(jugador =>
            jugador.puntuaciones.length >= 3
          )
          .sort((a, b) =>
            a.rango - b.rango ||
            b.promedio - a.promedio
          )[0] || null;
      const rey200 =
        [...jugadores].sort((a, b) =>
          b.cantidad200 - a.cantidad200 ||
          b.maxima - a.maxima
        )[0] || null;
      const fechas =
        valoresUnicos(
          lista.map(evento =>
            evento.fechaIso
          )
        ).sort();
      const jornadas =
        valoresUnicos(
          lista.flatMap(evento =>
            Array.isArray(evento.jornadas)
              ? evento.jornadas
              : []
          )
        );
      const competicion =
        selecciones.filtroCompeticion;
      const temporada =
        selecciones.filtroTemporada ||
        valoresUnicos(
          lista.map(evento =>
            evento.temporada
          )
        ).join(" · ");
      return {
        competicion,
        temporada,
        eventoCalendario,
        observacionGeneralTorneo,
        jugadores,
        mejorPromedio,
        mejorPartida,
        mayorProgreso,
        masRegular,
        rey200,
        numeroEventos:
          lista.length,
        numeroFechas:
          fechas.length,
        numeroJornadas:
          jornadas.length ||
          lista.length,
        totalJugadores:
          jugadores.length,
        totalPartidas:
          todasPuntuaciones.length,
        total200:
          todasPuntuaciones.filter(
            valor =>
              Number(valor) >= 200
          ).length,
        mediaGeneral:
          todasPuntuaciones.length
            ? todasPuntuaciones.reduce(
                (suma, valor) =>
                  suma + Number(valor || 0),
                0
              ) /
              todasPuntuaciones.length
            : 0,
        fechaInicial:
          fechas[0] || "",
        fechaFinal:
          fechas.at(-1) || ""
      };
    }
    function crearFilaClasificacionTorneo(
      jugador,
      posicion
    ) {
      return \`
        <div class="fila-jugador">
          <div class="jugador-nombre">
            \${posicion}.º
            \${escaparHtml(
              nombreVisible(jugador)
            )}
          </div>
          <div>
            \${formatearNumero(
              jugador.promedio
            )}
          </div>
          <div>
            \${jugador.maxima}
          </div>
          <div class="\${
            jugador.progreso >= 0
              ? "valor-positivo"
              : "valor-negativo"
          }">
            \${signo(jugador.progreso)}
          </div>
          <div>
            \${jugador.puntuaciones.length}
          </div>
        </div>
      \`;
    }
    function obtenerJugadorDelMes(
      lista
    ) {
      if (!lista.length) {
        return null;
      }
      /*
        Tomamos el mes más reciente presente en los filtros.
      */
      const eventoMasReciente =
        [...lista].sort((a, b) =>
          b.fechaMs - a.fechaMs
        )[0];
      if (!eventoMasReciente) {
        return null;
      }
      const fecha =
        new Date(
          eventoMasReciente.fechaMs
        );
      const anio =
        fecha.getFullYear();
      const mes =
        fecha.getMonth();
      const eventosMes =
        lista.filter(evento => {
          const fechaEvento =
            new Date(evento.fechaMs);
          return (
            fechaEvento.getFullYear() === anio &&
            fechaEvento.getMonth() === mes
          );
        });
      const jugadoresMap =
        new Map();
      eventosMes.forEach(evento => {
        evento.jugadores.forEach(jugador => {
          if (!jugadoresMap.has(jugador.nombre)) {
            jugadoresMap.set(
              jugador.nombre,
              {
                nombre:
                  jugador.nombre,
                alias:
                  jugador.alias,
                foto:
                  jugador.foto,
                total:
                  0,
                partidas:
                  0,
                mediaTemporada:
                  Number(
                    jugador.mediaTemporada ||
                    0
                  ),
                participaciones:
                  0
              }
            );
          }
          const dato =
            jugadoresMap.get(
              jugador.nombre
            );
          dato.total +=
            jugador.puntuaciones.reduce(
              (suma, valor) =>
                suma + Number(valor || 0),
              0
            );
          dato.partidas +=
            jugador.puntuaciones.length;
          dato.participaciones += 1;
          if (
            !dato.mediaTemporada &&
            jugador.mediaTemporada
          ) {
            dato.mediaTemporada =
              Number(
                jugador.mediaTemporada
              );
          }
        });
      });
      const candidatos =
        [...jugadoresMap.values()]
          .filter(jugador =>
            jugador.partidas >= 3
          )
          .map(jugador => {
            const promedioMes =
              jugador.total /
              jugador.partidas;
            const mejora =
              promedioMes -
              (
                jugador.mediaTemporada ||
                promedioMes
              );
            return {
              ...jugador,
              promedioMes,
              mejora
            };
          })
          .sort((a, b) =>
            b.mejora - a.mejora ||
            b.promedioMes - a.promedioMes ||
            b.partidas - a.partidas
          );
      if (!candidatos.length) {
        return null;
      }
      return {
        ...candidatos[0],
        mesTexto:
          new Date(
            anio,
            mes,
            1
          ).toLocaleDateString(
            "es-ES",
            {
              month: "long",
              year: "numeric"
            }
          )
      };
    }
    function crearBloqueJugadorMes(
      lista
    ) {
      const ganador =
        obtenerJugadorDelMes(lista);
      if (!ganador) {
        return "";
      }
      const mejoraTexto =
        signo(ganador.mejora);
      return \`
        <section class="seccion">
          <div class="cabecera-seccion">
            <h2>Jugador del mes</h2>
            <p>
              Premia el rendimiento por encima del nivel habitual
            </p>
          </div>
          <div class="jugador-mes">
            <div class="jugador-mes-icono">
              🌟
            </div>
            <div>
              <div class="jugador-mes-etiqueta">
                \${escaparHtml(
                  ganador.mesTexto
                )}
              </div>
              <div class="jugador-mes-nombre">
                \${escaparHtml(
                  nombreVisible(ganador)
                )}
              </div>
              <div class="jugador-mes-detalle">
                Promedio mensual:
                <strong>
                  \${formatearNumero(
                    ganador.promedioMes
                  )}
                </strong>
                ·
                \${ganador.partidas}
                partidas
                ·
                \${ganador.participaciones}
                participacion\${ganador.participaciones === 1 ? "" : "es"}
              </div>
            </div>
            <div class="jugador-mes-mejora">
              <strong>
                \${mejoraTexto}
              </strong>
              <span>
                sobre su media habitual
              </span>
            </div>
          </div>
        </section>
      \`;
    }
    function construirPalmaresTitulos(
      lista
    ) {
      const categorias = [
        {
          clave: "mvp",
          icono: "👑",
          nombre: "MVP",
          obtenerGanador: evento =>
            evento.mejorPromedio
        },
        {
          clave: "mejorPartida",
          icono: "🎳",
          nombre: "Mejor partida",
          obtenerGanador: evento =>
            evento.mejorPartida
        },
        {
          clave: "superacion",
          icono: "🚀",
          nombre: "Superación",
          obtenerGanador: evento =>
            evento.mayorProgreso &&
            evento.mayorProgreso.progreso > 0
              ? evento.mayorProgreso
              : null
        },
        {
          clave: "regularidad",
          icono: "🎯",
          nombre: "Regularidad",
          obtenerGanador: evento =>
            evento.masRegular
        },
        {
          clave: "rey200",
          icono: "🔥",
          nombre: "Rey del 200",
          obtenerGanador: evento =>
            evento.rey200 &&
            evento.rey200.cantidad200 > 0
              ? evento.rey200
              : null
        },
        {
          clave: "segundaVuelta",
          icono: "🏁",
          nombre: "Segunda vuelta",
          obtenerGanador: evento =>
            evento.mejorSegundaVuelta &&
            evento
              .mejorSegundaVuelta
              .mejoraSegundaVuelta > 0
              ? evento.mejorSegundaVuelta
              : null
        }
      ];
      const recuentos =
        new Map();
      const asegurarJugador = jugador => {
        const clave =
          jugador.nombre;
        if (!recuentos.has(clave)) {
          recuentos.set(clave, {
            nombre:
              jugador.nombre,
            alias:
              jugador.alias,
            foto:
              jugador.foto,
            total:
              0,
            titulos: {
              mvp: 0,
              mejorPartida: 0,
              superacion: 0,
              regularidad: 0,
              rey200: 0,
              segundaVuelta: 0
            }
          });
        }
        return recuentos.get(clave);
      };
      /*
        Solo se conceden títulos cuando han participado
        al menos dos jugadores de Pin Ocho.
      */
      lista
        .filter(evento =>
          evento.totalJugadores >= 2
        )
        .forEach(evento => {
          categorias.forEach(categoria => {
            const ganador =
              categoria.obtenerGanador(
                evento
              );
            if (!ganador) {
              return;
            }
            const registro =
              asegurarJugador(ganador);
            registro.titulos[
              categoria.clave
            ] += 1;
            registro.total += 1;
          });
        });
      const jugadores =
        [...recuentos.values()]
          .sort((a, b) =>
            b.total - a.total ||
            b.titulos.mvp -
              a.titulos.mvp ||
            String(a.nombre).localeCompare(
              String(b.nombre),
              "es"
            )
          );
      const lideres =
        categorias.map(categoria => {
          const clasificacion =
            jugadores
              .filter(jugador =>
                jugador.titulos[
                  categoria.clave
                ] > 0
              )
              .sort((a, b) =>
                b.titulos[
                  categoria.clave
                ] -
                a.titulos[
                  categoria.clave
                ] ||
                b.total - a.total
              );
          if (!clasificacion.length) {
            return {
              ...categoria,
              lideres: [],
              cantidad: 0
            };
          }
          const cantidad =
            clasificacion[0].titulos[
              categoria.clave
            ];
          return {
            ...categoria,
            cantidad,
            lideres:
              clasificacion.filter(
                jugador =>
                  jugador.titulos[
                    categoria.clave
                  ] === cantidad
              )
          };
        });
      return {
        categorias,
        lideres,
        jugadores,
        eventosComputados:
          lista.filter(evento =>
            evento.totalJugadores >= 2
          ).length
      };
    }
    function crearBloquePalmares(
      lista
    ) {
      const palmares =
        construirPalmaresTitulos(
          lista
        );
      if (
        !palmares.jugadores.length ||
        !palmares.eventosComputados
      ) {
        return "";
      }
      const categoriasHtml =
        palmares.lideres
          .filter(categoria =>
            categoria.cantidad > 0
          )
          .map(categoria => {
            const nombres =
              categoria.lideres
                .map(jugador =>
                  escaparHtml(
                    nombreVisible(jugador)
                  )
                )
                .join(" · ");
            return \`
              <article class="titulo-categoria">
                <div class="titulo-categoria-icono">
                  \${categoria.icono}
                </div>
                <div class="titulo-categoria-nombre">
                  \${escaparHtml(
                    categoria.nombre
                  )}
                </div>
                <div class="titulo-categoria-lider">
                  \${nombres}
                </div>
                <div class="titulo-categoria-valor">
                  \${categoria.cantidad}
                  título\${categoria.cantidad === 1 ? "" : "s"}
                </div>
              </article>
            \`;
          })
          .join("");
      const rankingHtml =
        palmares.jugadores
          .map((jugador, indice) => {
            const medalla =
              indice === 0
                ? "🥇"
                : indice === 1
                  ? "🥈"
                  : indice === 2
                    ? "🥉"
                    : (indice + 1) + ".º";
            return \`
              <div class="ranking-titulo-fila">
                <div class="ranking-posicion">
                  \${medalla}
                </div>
                <div class="ranking-jugador">
                  \${escaparHtml(
                    nombreVisible(jugador)
                  )}
                </div>
                <div class="ranking-total">
                  \${jugador.total}
                  título\${jugador.total === 1 ? "" : "s"}
                </div>
              </div>
            \`;
          })
          .join("");
      return \`
        <section class="seccion">
          <div class="cabecera-seccion">
            <h2>Marcador de títulos</h2>
            <p>
              Reconocimientos acumulados dentro de los filtros activos
            </p>
          </div>
          <div class="palmares">
            <div class="palmares-cabecera">
              <h3>
                Los líderes de cada premio
              </h3>
              <p>
                Se contabilizan
                \${palmares.eventosComputados}
                evento\${palmares.eventosComputados === 1 ? "" : "s"}
                con al menos dos participantes.
              </p>
            </div>
            <div class="palmares-categorias">
              \${categoriasHtml}
            </div>
            <div class="ranking-titulos">
              <h4>
                Clasificación general
              </h4>
              <div class="ranking-titulos-lista">
                \${rankingHtml}
              </div>
            </div>
          </div>
        </section>
      \`;
    }
    function renderizarResumenTorneo(
      lista,
      selecciones
    ) {
      const contenedor =
        document.getElementById(
          "contenidoResultados"
        );
      if (!lista.length) {
        contenedor.innerHTML = \`
          <div class="sin-resultados">
            No hay resultados para este torneo.
          </div>
        \`;
        return;
      }
      const torneo =
        construirResumenTorneo(
          lista,
          selecciones
        );
      const participantes =
        torneo.jugadores
          .map(jugador =>
            nombreVisible(jugador)
          )
          .join(", ");
      const periodo =
        torneo.fechaInicial &&
        torneo.fechaFinal
          ? (
              torneo.fechaInicial ===
              torneo.fechaFinal
                ? formatearFecha(
                    torneo.fechaInicial
                  )
                : formatearFecha(
                    torneo.fechaInicial
                  ) +
                  " – " +
                  formatearFecha(
                    torneo.fechaFinal
                  )
            )
          : "";
      const filas =
        torneo.jugadores
          .map((jugador, indice) =>
            crearFilaClasificacionTorneo(
              jugador,
              indice + 1
            )
          )
          .join("");
      const tituloTorneo =
        selecciones.tituloTorneo ||
        torneo.eventoCalendario ||
        torneo.competicion;
      const cronicaGuardada =
        obtenerCronicaIA(
          tituloTorneo
        );
      const cronicaHtml =
        cronicaGuardada
          ? crearBloqueCronicaIA(
              tituloTorneo
            )
          : crearCronicaTorneo(
              torneo,
              tituloTorneo
            );
      contenedor.innerHTML = \`
        <section class="seccion">
          <div class="cabecera-seccion">
            <h2>Resumen</h2>
            <p>Participación de Pin Ocho</p>
          </div>
          <article class="jornada-principal">
            <div class="portada-jornada">
              <div class="linea-superior">
                <span class="insignia">
                  \${escaparHtml(
                    torneo.competicion
                  )}
                </span>
                <span class="meta">
                  \${escaparHtml(
                    torneo.temporada
                  )}
                  \${periodo
                    ? " · " +
                      escaparHtml(periodo)
                    : ""
                  }
                </span>
              </div>
              <h2>
                \${escaparHtml(
                  tituloTorneo
                )}
              </h2>
              \${torneo.totalJugadores > 1
                ? \`
                    <div class="participantes-jornada">
                      <strong>Participantes de Pin Ocho:</strong>
                      \${escaparHtml(participantes)}
                    </div>
                  \`
                : ""
              }
            </div>
            \${cronicaHtml}
            \${crearMvpMejora(
              torneo
            )}
          </article>
        </section>
        <section class="seccion">
          <div class="cabecera-seccion">
            <h2>Resultados</h2>
            <p>Detalle de la participación</p>
          </div>
          <div class="detalle visible">
            <div class="tabla-jugadores">
              <div class="fila-jugador cabecera-tabla">
                <div>Jugador</div>
                <div>Promedio</div>
                <div>Mejor</div>
                <div>Sobre su media</div>
                <div>Partidas</div>
              </div>
              \${filas}
            </div>
          </div>
        </section>
      \`;
    }
    function construirResumenTemporada(
      lista,
      selecciones
    ) {
      const jugadoresMap = new Map();
      /*
        Para el premio de evolución buscamos la temporada
        inmediatamente anterior disponible en toda la base.
      */
      const temporadasDisponibles =
        valoresUnicos(
          jornadas.map(evento =>
            evento.temporada
          )
        )
          .sort((a, b) => {
            const inicioA =
              Number(
                String(a).match(/\\d{4}/)?.[0] || 0
              );
            const inicioB =
              Number(
                String(b).match(/\\d{4}/)?.[0] || 0
              );
            return inicioA - inicioB;
          });
      const indiceTemporadaActual =
        temporadasDisponibles.indexOf(
          selecciones.filtroTemporada
        );
      const temporadaAnterior =
        indiceTemporadaActual > 0
          ? temporadasDisponibles[
              indiceTemporadaActual - 1
            ]
          : "";
      const mediasTemporadaAnterior =
        new Map();
      if (temporadaAnterior) {
        const acumuladosAnteriores =
          new Map();
        jornadas
          .filter(evento =>
            evento.temporada ===
            temporadaAnterior
          )
          .forEach(evento => {
            evento.jugadores.forEach(jugador => {
              const clave =
                jugador.nombre;
              if (!acumuladosAnteriores.has(clave)) {
                acumuladosAnteriores.set(
                  clave,
                  {
                    total: 0,
                    cantidad: 0
                  }
                );
              }
              const dato =
                acumuladosAnteriores.get(clave);
              jugador.puntuaciones.forEach(
                puntuacion => {
                  dato.total +=
                    Number(puntuacion || 0);
                  dato.cantidad += 1;
                }
              );
            });
          });
        acumuladosAnteriores.forEach(
          (dato, jugador) => {
            if (dato.cantidad > 0) {
              mediasTemporadaAnterior.set(
                jugador,
                dato.total / dato.cantidad
              );
            }
          }
        );
      }
      lista.forEach(evento => {
        evento.jugadores.forEach(jugadorEvento => {
          const clave =
            jugadorEvento.nombre;
          if (!jugadoresMap.has(clave)) {
            jugadoresMap.set(clave, {
              nombre:
                jugadorEvento.nombre,
              alias:
                jugadorEvento.alias,
              foto:
                jugadorEvento.foto,
              puntuaciones:
                [],
              mediaTemporada:
                Number(
                  jugadorEvento.mediaTemporada ||
                  0
                ),
              competiciones:
                new Set(),
              fechas:
                new Set()
            });
          }
          const jugador =
            jugadoresMap.get(clave);
          jugador.puntuaciones.push(
            ...jugadorEvento.puntuaciones
          );
          jugador.competiciones.add(
            evento.competicion
          );
          jugador.fechas.add(
            evento.fechaIso
          );
        });
      });
      const jugadores =
        [...jugadoresMap.values()]
          .map(jugador => {
            const total =
              jugador.puntuaciones.reduce(
                (suma, valor) =>
                  suma + Number(valor || 0),
                0
              );
            const promedio =
              jugador.puntuaciones.length
                ? total /
                  jugador.puntuaciones.length
                : 0;
            const maxima =
              jugador.puntuaciones.length
                ? Math.max(
                    ...jugador.puntuaciones
                  )
                : 0;
            const minima =
              jugador.puntuaciones.length
                ? Math.min(
                    ...jugador.puntuaciones
                  )
                : 0;
            const rango =
              maxima - minima;
            const cantidad200 =
              jugador.puntuaciones.filter(
                valor =>
                  Number(valor) >= 200
              ).length;
            const mediaAnterior =
              mediasTemporadaAnterior.has(
                jugador.nombre
              )
                ? mediasTemporadaAnterior.get(
                    jugador.nombre
                  )
                : null;
            const evolucion =
              mediaAnterior !== null
                ? promedio - mediaAnterior
                : null;
            return {
              ...jugador,
              total,
              promedio,
              maxima,
              minima,
              rango,
              cantidad200,
              mediaAnterior,
              evolucion,
              /*
                Reutilizamos progreso en la tabla de temporada,
                pero ahora significa evolución interanual.
              */
              progreso:
                evolucion !== null
                  ? evolucion
                  : 0,
              numeroCompeticiones:
                jugador.competiciones.size,
              numeroFechas:
                jugador.fechas.size
            };
          })
          .sort((a, b) =>
            b.promedio - a.promedio ||
            b.maxima - a.maxima ||
            String(a.nombre).localeCompare(
              String(b.nombre),
              "es"
            )
          );
      const todasPuntuaciones =
        jugadores.flatMap(
          jugador =>
            jugador.puntuaciones
        );
      const mejorPromedio =
        jugadores[0] || null;
      const mejorPartida =
        [...jugadores].sort((a, b) =>
          b.maxima - a.maxima ||
          b.promedio - a.promedio
        )[0] || null;
      const mayorEvolucion =
        [...jugadores]
          .filter(jugador =>
            jugador.evolucion !== null
          )
          .sort((a, b) =>
            b.evolucion - a.evolucion ||
            b.promedio - a.promedio
          )[0] || null;
      const masRegular =
        [...jugadores]
          .filter(jugador =>
            jugador.puntuaciones.length >= 3
          )
          .sort((a, b) =>
            a.rango - b.rango ||
            b.promedio - a.promedio
          )[0] || null;
      const rey200 =
        [...jugadores].sort((a, b) =>
          b.cantidad200 - a.cantidad200 ||
          b.maxima - a.maxima
        )[0] || null;
      const fechas =
        valoresUnicos(
          lista.map(evento =>
            evento.fechaIso
          )
        ).sort();
      const competiciones =
        valoresUnicos(
          lista.map(evento =>
            evento.competicion
          )
        ).sort((a, b) =>
          String(a).localeCompare(
            String(b),
            "es",
            {
              numeric: true,
              sensitivity: "base"
            }
          )
        );
      return {
        temporada:
          selecciones.filtroTemporada,
        jugadores,
        mejorPromedio,
        mejorPartida,
        mayorEvolucion,
        temporadaAnterior,
        masRegular,
        rey200,
        competiciones,
        numeroCompeticiones:
          competiciones.length,
        numeroEventos:
          lista.length,
        numeroFechas:
          fechas.length,
        totalJugadores:
          jugadores.length,
        totalPartidas:
          todasPuntuaciones.length,
        total200:
          todasPuntuaciones.filter(
            valor =>
              Number(valor) >= 200
          ).length,
        mediaGeneral:
          todasPuntuaciones.length
            ? todasPuntuaciones.reduce(
                (suma, valor) =>
                  suma + Number(valor || 0),
                0
              ) /
              todasPuntuaciones.length
            : 0,
        fechaInicial:
          fechas[0] || "",
        fechaFinal:
          fechas.at(-1) || ""
      };
    }
    function crearTarjetaCompeticionTemporada(
      competicion,
      temporada
    ) {
      const eventos =
        jornadas.filter(jornada =>
          jornada.temporada === temporada &&
          jornada.competicion === competicion
        );
      const jugadores =
        valoresUnicos(
          eventos.flatMap(evento =>
            evento.jugadores.map(jugador =>
              nombreVisible(jugador)
            )
          )
        );
      const totalPartidas =
        eventos.reduce(
          (suma, evento) =>
            suma + evento.totalPartidas,
          0
        );
      const todasPuntuaciones =
        eventos.flatMap(evento =>
          evento.jugadores.flatMap(jugador =>
            jugador.puntuaciones
          )
        );
      const media =
        todasPuntuaciones.length
          ? todasPuntuaciones.reduce(
              (suma, valor) =>
                suma + Number(valor || 0),
              0
            ) /
            todasPuntuaciones.length
          : 0;
      return \`
        <article class="tarjeta-jornada">
          <div>
            <span class="insignia">
              \${escaparHtml(competicion)}
            </span>
            <h3>
              \${escaparHtml(competicion)}
            </h3>
            <div class="tarjeta-meta">
              \${eventos.length}
              evento\${eventos.length === 1 ? "" : "s"}
              ·
              \${totalPartidas}
              partidas
            </div>
            <div class="mini-destacado">
              <span>Media del club</span>
              <strong>
                \${formatearNumero(media)}
              </strong>
            </div>
            <div class="mini-destacado">
              <span>Participantes</span>
              <strong>
                \${escaparHtml(
                  jugadores.join(", ")
                )}
              </strong>
            </div>
          </div>
          <div class="tarjeta-acciones">
            <button
              class="boton-secundario"
              onclick="seleccionarCompeticion(
                '\${escaparHtml(competicion)}'
              )"
            >
              Ver torneo
            </button>
          </div>
        </article>
      \`;
    }
    function seleccionarCompeticion(
      competicion
    ) {
      const selector =
        document.getElementById(
          "filtroCompeticion"
        );
      selector.value =
        competicion;
      alCambiarFiltro(
        "filtroCompeticion"
      );
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    }
    function renderizarResumenTemporada(
      lista,
      selecciones
    ) {
      const contenedor =
        document.getElementById(
          "contenidoResultados"
        );
      if (!lista.length) {
        contenedor.innerHTML = \`
          <div class="sin-resultados">
            No hay resultados para esta temporada.
          </div>
        \`;
        return;
      }
      const temporada =
        construirResumenTemporada(
          lista,
          selecciones
        );
      const participantes =
        temporada.jugadores
          .map(jugador =>
            nombreVisible(jugador)
          )
          .join(", ");
      const periodo =
        temporada.fechaInicial &&
        temporada.fechaFinal
          ? (
              temporada.fechaInicial ===
              temporada.fechaFinal
                ? formatearFecha(
                    temporada.fechaInicial
                  )
                : formatearFecha(
                    temporada.fechaInicial
                  ) +
                  " – " +
                  formatearFecha(
                    temporada.fechaFinal
                  )
            )
          : "";
      const filas =
        temporada.jugadores
          .map((jugador, indice) =>
            crearFilaClasificacionTorneo(
              jugador,
              indice + 1
            )
          )
          .join("");
      const tarjetasCompeticiones =
        temporada.competiciones
          .map(competicion =>
            crearTarjetaCompeticionTemporada(
              competicion,
              temporada.temporada
            )
          )
          .join("");
      contenedor.innerHTML = \`
        <section class="seccion">
          <div class="cabecera-seccion">
            <h2>Resumen de temporada</h2>
            <p>
              Informe acumulado de todas las competiciones
            </p>
          </div>
          <article class="jornada-principal">
            <div class="portada-jornada">
              <div class="linea-superior">
                <span class="insignia">
                  Temporada
                </span>
                <span class="meta">
                  \${escaparHtml(
                    temporada.temporada
                  )}
                  \${periodo
                    ? " · " +
                      escaparHtml(periodo)
                    : ""
                  }
                </span>
              </div>
              <h2>
                Temporada
                \${escaparHtml(
                  temporada.temporada
                )}
              </h2>
              <div class="subtitulo-jornada">
                \${temporada.numeroCompeticiones}
                competicion\${temporada.numeroCompeticiones === 1 ? "" : "es"}
                ·
                \${temporada.numeroFechas}
                fechas
                ·
                \${temporada.totalPartidas}
                partidas
              </div>
              <div class="participantes-jornada">
                <strong>
                  Jugadores participantes:
                </strong>
                \${escaparHtml(participantes)}
              </div>
            </div>
            <div class="premios">
              \${crearPremio(
                "👑",
                "MVP de la temporada",
                temporada.mejorPromedio,
                formatearNumero(
                  temporada.mejorPromedio?.promedio
                ) +
                  " de promedio",
                true
              )}
              \${crearPremio(
                "🎳",
                "Mejor partida",
                temporada.mejorPartida,
                String(
                  temporada.mejorPartida?.maxima ??
                  "—"
                ) +
                  " bolos"
              )}
              \${temporada.mayorEvolucion
                ? crearPremio(
                    "🚀",
                    "Mayor evolución",
                    temporada.mayorEvolucion,
                    signo(
                      temporada
                        .mayorEvolucion
                        .evolucion
                    ) +
                      " bolos respecto a " +
                      temporada.temporadaAnterior
                  )
                : ""
              }
              \${crearPremio(
                "🎯",
                "El más regular",
                temporada.masRegular,
                temporada.masRegular
                  ? "Solo " +
                    temporada.masRegular.rango +
                    " bolos entre su mejor y peor partida"
                  : "Se requieren 3 partidas"
              )}
              \${crearPremio(
                "🔥",
                "Rey del 200",
                temporada.rey200,
                temporada.rey200
                  ? temporada.rey200.cantidad200 +
                    " partida" +
                    (
                      temporada.rey200.cantidad200 === 1
                        ? ""
                        : "s"
                    ) +
                    " de 200+"
                  : "—"
              )}
            </div>
            <div class="resumen-numerico">
              <div class="dato">
                <strong>
                  \${formatearNumero(
                    temporada.mediaGeneral
                  )}
                </strong>
                <span>Media de la temporada</span>
              </div>
              <div class="dato">
                <strong>
                  \${temporada.total200}
                </strong>
                <span>Partidas de 200+</span>
              </div>
              <div class="dato">
                <strong>
                  \${temporada.totalJugadores}
                </strong>
                <span>Jugadores</span>
              </div>
              <div class="dato">
                <strong>
                  \${temporada.numeroCompeticiones}
                </strong>
                <span>Competiciones</span>
              </div>
            </div>
          </article>
        </section>
        <section class="seccion">
          <div class="cabecera-seccion">
            <h2>Clasificación de la temporada</h2>
            <p>
              Ordenada por promedio acumulado
            </p>
          </div>
          <div class="detalle visible">
            <div class="tabla-jugadores">
              <div class="fila-jugador cabecera-tabla">
                <div>Jugador</div>
                <div>Promedio</div>
                <div>Mejor</div>
                <div>Evolución</div>
                <div>Partidas</div>
              </div>
              \${filas}
            </div>
          </div>
        </section>
        <section class="seccion">
          <div class="cabecera-seccion">
            <h2>Competiciones de la temporada</h2>
            <p>
              Pulsa una competición para abrir su informe acumulado
            </p>
          </div>
          <div class="rejilla-jornadas">
            \${tarjetasCompeticiones}
          </div>
        </section>
      \`;
    }
    function obtenerJornadasTorneoFinalizado(torneo) {
      return jornadas.filter(jornada =>
        jornada.temporada === torneo.temporada &&
        jornada.competicion === torneo.competicion &&
        jornada.fechaIso >= torneo.fechaInicio &&
        jornada.fechaIso <= torneo.fechaFin
      );
    }
    function crearTarjetaTorneoFinalizado(torneo) {
      const listaTorneo =
        obtenerJornadasTorneoFinalizado(torneo);
      if (!listaTorneo.length) {
        return "";
      }
      const resumen =
        construirResumenTorneo(
          listaTorneo,
          {
            filtroCompeticion:
              torneo.competicion,
            filtroTemporada:
              torneo.temporada,
            eventoCalendario:
              torneo.tituloCalendario,
            tituloTorneo:
              torneo.tituloCalendario
          }
        );
      const participantes =
        resumen.jugadores
          .map(jugador =>
            nombreVisible(jugador)
          )
          .join(", ");
      const periodo =
        torneo.fechaInicio === torneo.fechaFin
          ? formatearFecha(torneo.fechaInicio)
          : formatearFecha(torneo.fechaInicio) +
            " – " +
            formatearFecha(torneo.fechaFin);
      return \`
        <article class="tarjeta-jornada">
          <div>
            <span class="insignia">
              Resumen final
            </span>
            <h3>
              \${escaparHtml(
                torneo.tituloCalendario ||
                torneo.competicion
              )}
            </h3>
            <div class="tarjeta-meta">
              \${escaparHtml(periodo)}
              ·
              \${resumen.totalPartidas}
              partidas
            </div>
            <div class="mini-destacado">
              <span>Media del club</span>
              <strong>
                \${formatearNumero(
                  resumen.mediaGeneral
                )}
              </strong>
            </div>
            <div class="mini-destacado">
              <span>Participantes</span>
              <strong>
                \${escaparHtml(participantes)}
              </strong>
            </div>
          </div>
          <div class="tarjeta-acciones">
            <button
              class="boton-secundario"
              onclick="abrirTorneoFinalizado(
                '\${escaparHtml(torneo.id)}'
              )"
            >
              Ver informe completo
            </button>
          </div>
        </article>
      \`;
    }
    function abrirTorneoFinalizado(id) {
      const torneo =
        torneosFinalizados.find(
          elemento => elemento.id === id
        );
      if (!torneo) return;
      const listaTorneo =
        obtenerJornadasTorneoFinalizado(torneo);
      if (!listaTorneo.length) return;
      renderizarResumenTorneo(
        listaTorneo,
        {
          filtroCompeticion:
            torneo.competicion,
          filtroTemporada:
            torneo.temporada,
          eventoCalendario:
            torneo.tituloCalendario,
          tituloTorneo:
            torneo.tituloCalendario
        }
      );
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    }
    function renderizarResultados(
      lista,
      selecciones = {},
      soloUltimos = false
    ) {
      const contenedor =
        document.getElementById("contenidoResultados");
      if (!lista.length) {
        contenedor.innerHTML = \`
          <div class="sin-resultados">
            No hay resultados que coincidan con los filtros.
          </div>
        \`;
        return;
      }
      const ultima = lista[0];
      const mismaJornadaQueUltima = jornada =>
        jornada.fechaIso === ultima.fechaIso &&
        normalizarClaveResultado(jornada.eventoCalendario) ===
          normalizarClaveResultado(ultima.eventoCalendario) &&
        normalizarClaveResultado(jornada.jornada) ===
          normalizarClaveResultado(ultima.jornada);
      const grupoUltimaJornada = lista.filter(mismaJornadaQueUltima);
      const restoJornadas = lista.filter(jornada => !mismaJornadaQueUltima(jornada));
      const fechaReferencia = ultima.fechaMs;
      const limite = fechaReferencia -
        DIAS_RECIENTES * 24 * 60 * 60 * 1000;
      const recientes = restoJornadas
        .filter(j => j.fechaMs >= limite);
      const historicas = restoJornadas
        .filter(j => j.fechaMs < limite);
      const sinFiltrosDeDetalle =
        !selecciones.filtroCompeticion &&
        !selecciones.filtroJornada &&
        !selecciones.filtroFecha;
      const torneosVisibles =
        sinFiltrosDeDetalle
          ? torneosFinalizados.filter(torneo => {
              const fin = new Date(
                torneo.fechaFin + "T00:00:00"
              ).getTime();
              const dentroDeVentana =
                Number.isFinite(fin) &&
                fin >= limite;
              const mismaTemporada =
                !selecciones.filtroTemporada ||
                torneo.temporada ===
                  selecciones.filtroTemporada;
              return (
                dentroDeVentana &&
                mismaTemporada
              );
            })
          : [];
      let html = "";
      if (torneosVisibles.length) {
        html += \`
          <section class="seccion">
            <div class="cabecera-seccion">
              <h2>Torneos finalizados</h2>
              <p>
                Informe acumulado generado automáticamente
                al vencer la fecha final del calendario
              </p>
            </div>
            <div class="rejilla-jornadas">
              \${torneosVisibles
                .map(crearTarjetaTorneoFinalizado)
                .join("")
              }
            </div>
          </section>
        \`;
      }
      html += grupoUltimaJornada
        .map((jornada, indice) => crearJornadaPrincipal(jornada, indice === 0))
        .join("");
      if (recientes.length) {
        html += \`
          <section class="seccion">
            <div class="cabecera-seccion">
              <h2>Jornadas recientes</h2>
              <p>Últimos \${DIAS_RECIENTES} días respecto a la jornada más reciente</p>
            </div>
            <div class="rejilla-jornadas">
              \${recientes.map(crearTarjetaJornada).join("")}
            </div>
          </section>
        \`;
      }
      if (!soloUltimos && historicas.length) {
        html += \`
          <section class="seccion">
            <div class="cabecera-seccion">
              <h2>Histórico</h2>
              <p>Las jornadas anteriores siguen disponibles</p>
            </div>
            <div class="rejilla-jornadas">
              \${historicas.map(crearTarjetaJornada).join("")}
            </div>
          </section>
        \`;
      }
      contenedor.innerHTML = html;
    }
    function abrirDetalle(id) {
      const jornada = jornadas.find(j => j.id === id);
      const detalle =
        document.getElementById("detalleJornada");
      if (!jornada || !detalle) return;
      const filas = jornada.jugadores
        .map(jugador => \`
          <div class="fila-jugador">
            <div class="jugador-nombre">
              \${escaparHtml(nombreVisible(jugador))}
            </div>
            <div>
              \${formatearNumero(jugador.promedio)}
            </div>
            <div>
              \${jugador.maxima}
            </div>
            <div class="\${
              jugador.progreso >= 0
                ? "valor-positivo"
                : "valor-negativo"
            }">
              \${signo(jugador.progreso)}
            </div>
            <div>
              \${jugador.puntuaciones.length}
            </div>
          </div>
        \`)
        .join("");
      detalle.innerHTML = \`
        <div class="detalle-cabecera">
          <div>
            <div class="eyebrow">
              \${escaparHtml(jornada.competicion)}
            </div>
            <h2>
              \${escaparHtml(jornada.competicion)}
            </h2>
            \${jornada.marcas && jornada.marcas.length
              ? \`
                  <div class="subtitulo-jornada">
                    \${escaparHtml(jornada.marcas.join(" · "))}
                  </div>
                \`
              : ""
            }
            <div class="subtitulo-jornada">
              \${escaparHtml(formatearFecha(jornada.fechaIso))}
              · Media del equipo:
              \${formatearNumero(jornada.mediaEquipo)}
            </div>
          </div>
          <button
            class="cerrar"
            onclick="cerrarDetalle()"
          >
            Cerrar
          </button>
        </div>
        <div class="tabla-jugadores">
          <div class="fila-jugador cabecera-tabla">
            <div>Jugador</div>
            <div>Promedio</div>
            <div>Mejor</div>
            <div>Sobre su media</div>
            <div>Partidas</div>
          </div>
          \${filas}
        </div>
      \`;
      detalle.classList.add("visible");
      detalle.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
    function cerrarDetalle() {
      const detalle =
        document.getElementById("detalleJornada");
      if (!detalle) return;
      detalle.classList.remove("visible");
      detalle.innerHTML = "";
    }
    if (jornadas.length) {
      cargarPortadaInformes();
      cargarTemporadasPalmares();
      mostrarPortadaResultados();
    }
  </script>
</body>
</html>
  `;
}
function construirPaginaError(mensaje) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >
  <title>Error - Resultados</title>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      min-height: 100vh;
      margin: 0;
      padding: 24px;
      display: grid;
      place-items: center;
      font-family: Arial, Helvetica, sans-serif;
      color: #fffaf0;
      background:
        radial-gradient(
          circle at 15% 0%,
          rgba(214,168,76,0.13),
          transparent 34%
        ),
        linear-gradient(
          180deg,
          #281911,
          #140d08
        );
    }
    .error {
      width: min(680px, 100%);
      padding: 32px;
      text-align: center;
      background: #2a1b12;
      border: 1px solid rgba(214, 168, 76, 0.42);
      border-radius: 20px;
      box-shadow: 0 18px 44px rgba(0,0,0,0.28);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 34px;
    }
    p {
      margin: 0;
      color: #d9c7ae;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="error">
    <h1>No se han podido cargar los resultados</h1>
    <p>${escaparHtml(mensaje)}</p>
  </div>
</body>
</html>
  `;
}
function obtenerCampo(objeto, nombres) {
  if (!objeto || typeof objeto !== "object") {
    return "";
  }
  for (const nombre of nombres) {
    if (
      Object.prototype.hasOwnProperty.call(
        objeto,
        nombre
      )
    ) {
      return objeto[nombre];
    }
  }
  const claves = Object.keys(objeto);
  const mapaNormalizado = new Map(
    claves.map(clave => [
      normalizarNombreCampo(clave),
      clave
    ])
  );
  for (const nombre of nombres) {
    const claveReal =
      mapaNormalizado.get(
        normalizarNombreCampo(nombre)
      );
    if (claveReal) {
      return objeto[claveReal];
    }
  }
  return "";
}
function normalizarNombreCampo(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}
function interpretarFecha(valor) {
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return construirFechaNormalizada(valor);
  }
  if (typeof valor === "number") {
    // Número serial de Excel / Google Sheets.
    if (valor > 20000 && valor < 100000) {
      const ms = Math.round(
        (valor - 25569) * 86400 * 1000
      );
      return construirFechaNormalizada(
        new Date(ms)
      );
    }
    const fechaNumero = new Date(valor);
    if (!isNaN(fechaNumero.getTime())) {
      return construirFechaNormalizada(fechaNumero);
    }
  }
  const texto = textoLimpio(valor);
  if (!texto) {
    return {
      valida: false,
      fecha: null,
      iso: "",
      ms: 0
    };
  }
  let fecha;
  const ddmmyyyy =
    texto.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    fecha = new Date(
      Number(ddmmyyyy[3]),
      Number(ddmmyyyy[2]) - 1,
      Number(ddmmyyyy[1])
    );
  } else {
    fecha = new Date(texto);
  }
  if (isNaN(fecha.getTime())) {
    return {
      valida: false,
      fecha: null,
      iso: "",
      ms: 0
    };
  }
  return construirFechaNormalizada(fecha);
}
function construirFechaNormalizada(fechaOriginal) {
  const fecha = new Date(
    fechaOriginal.getFullYear(),
    fechaOriginal.getMonth(),
    fechaOriginal.getDate()
  );
  const iso = [
    fecha.getFullYear(),
    String(fecha.getMonth() + 1).padStart(2, "0"),
    String(fecha.getDate()).padStart(2, "0")
  ].join("-");
  return {
    valida: true,
    fecha,
    iso,
    ms: fecha.getTime()
  };
}
function obtenerTemporadaDesdeFecha(valorFecha) {
  /*
    Acepta objetos Date, textos de fecha y valores numéricos.
    Así evitamos depender de que la fecha llegue siempre como
    una instancia Date exacta dentro del entorno de Cloudflare.
  */
  const fecha =
    valorFecha instanceof Date
      ? valorFecha
      : new Date(valorFecha);
  if (
    !fecha ||
    Number.isNaN(fecha.getTime())
  ) {
    return "";
  }
  const mes =
    fecha.getMonth() + 1;
  const anio =
    fecha.getFullYear();
  if (mes >= 7) {
    return `${anio}/${String(anio + 1).slice(-2)}`;
  }
  return `${anio - 1}/${String(anio).slice(-2)}`;
}
function crearId(texto) {
  let hash = 2166136261;
  for (let i = 0; i < texto.length; i += 1) {
    hash ^= texto.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `j-${(hash >>> 0).toString(36)}`;
}
function textoLimpio(valor) {
  return String(valor ?? "").trim();
}
function numero(valor) {
  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return NaN;
  }
  const limpio = String(valor)
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  const resultado = Number(limpio);
  return Number.isFinite(resultado)
    ? resultado
    : NaN;
}
function sumar(lista) {
  return lista.reduce(
    (total, valor) => total + valor,
    0
  );
}
function compararTexto(a, b) {
  return String(a || "").localeCompare(
    String(b || ""),
    "es",
    {
      numeric: true,
      sensitivity: "base"
    }
  );
}
function nombreVisible(jugador) {
  if (!jugador) {
    return "—";
  }
  return jugador.alias ||
    jugador.nombre ||
    "—";
}
function formatearNumero(valor) {
  return Number(valor || 0).toLocaleString(
    "es-ES",
    {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }
  );
}
function escaparHtml(texto) {
  return String(texto || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

Deno.serve((request) => resultsHandler.fetch(request));
