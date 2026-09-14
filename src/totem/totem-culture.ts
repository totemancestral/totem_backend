// Bibliotheque culturelle regionale (Doc 17), au service du Recit (Doc 16bis,
// recommandation 1). Chaque fiche est une trame de fond reelle prêtee a
// l'ancetre imaginaire du client, jamais une affirmation genealogique sur le
// client lui-meme (ligne rouge, Doc 16bis 1.2). Contenu statique, comme
// totem-animals.ts : pas de dependance a une base de donnees.

export type CultureRegion = "ouest" | "centrale" | "est" | "australe";

export type CultureFiche = {
  region: CultureRegion;
  zone: string;
  royaumes: string;
  cosmogonie: string;
  pratiques: string;
  valeurs: string;
  contes: string;
};

export const CULTURE_FICHES: Record<CultureRegion, CultureFiche> = {
  ouest: {
    region: "ouest",
    zone: "Senegal, Mali, Guinee, Cote d'Ivoire, Nigeria, Ghana, Benin et les terres voisines",
    royaumes:
      "l'empire du Mali fonde par Soundiata Keita, l'empire Songhai, le royaume Ashanti du Ghana, le royaume du Dahomey a Abomey et les peuples Fon, Yoruba et Adja du golfe du Benin, le royaume d'Ife et d'Oyo chez les Yoruba du Nigeria",
    cosmogonie:
      "le Vodun, ensemble de forces spirituelles qui habitent la nature, les ancetres et les elements chez les Fon du golfe du Benin, honorees et non craintes ; la religion Yoruba organisee autour des Orisha et de l'art divinatoire de l'Ifa ; la cosmogonie mandingue, ou le monde est structure par des forces vitales, le nyama",
    pratiques:
      "le griot, jeli en mandingue, depositaire de la memoire orale et de la genealogie des grandes familles ; le tambour parlant, qui reproduit les tons de la langue pour porter des messages a distance ; le tissage kente du peuple Akan, dont chaque motif porte un nom et un sens",
    valeurs:
      "l'art de la parole comme pouvoir et comme devoir, le griot ne mentant jamais sciemment ; le courage guerrier, illustre par les regiments feminins du royaume du Dahomey, les Agojie ; la teranga, l'hospitalite comme valeur cardinale chez les Wolof du Senegal",
    contes:
      "l'epreuve initiatique au bord de l'eau, la ruse qui triomphe de la force, le retour du voyageur transforme ; l'epopee de Soundiata Keita, fondateur de l'empire du Mali ; les contes d'Anansi, l'araignee rusee qui triomphe par l'intelligence plutot que par la force",
  },
  centrale: {
    region: "centrale",
    zone: "Congo, Cameroun, Gabon, Republique centrafricaine et les terres voisines",
    royaumes:
      "le royaume Kongo, capitale Mbanza Kongo, l'un des Etats les mieux organises d'Afrique centrale precoloniale ; le royaume Luba et le royaume Lunda du bassin du fleuve Congo ; les peuples Fang et Mitsogho du Gabon",
    cosmogonie:
      "Nzambi a Mpungu, l'etre supreme de la cosmogonie kongo, tandis que les ancetres, les bakulu, assurent la mediation quotidienne avec les vivants ; le Bwiti, tradition initiatique du Gabon organisee autour du culte des ancetres, evoquee ici comme heritage culturel et jamais dans le detail de son rite",
    pratiques:
      "les minkisi, objets de pouvoir kongo dans lesquels un specialiste rituel fixe une force spirituelle de protection ; les masques Fang, Kuba et Punu, parmi les plus connus de la sculpture africaine ; le tissage de raffia du peuple Kuba, orne de motifs geometriques complexes",
    valeurs:
      "une organisation en partie matrilineaire chez les Kongo ; le courage et la strategie politique, illustres par la reine Njinga Mbandi qui resista des decennies a la colonisation portugaise ; la sagesse initiatique, un statut social eleve se gagnant par le passage d'epreuves rituelles",
    contes:
      "l'epreuve de la foret initiatique, la traversee du monde des ancetres guidee par un esprit protecteur, le retour transforme du neophyte ; le Mvet, epopee chantee du peuple Fang ; les contes de la tortue rusee, qui triomphe par la patience et l'intelligence",
  },
  est: {
    region: "est",
    zone: "Kenya, Tanzanie, Ethiopie, Ouganda et la cote swahilie",
    royaumes:
      "le royaume d'Aksoum, ancienne puissance commerciale du nord de l'Ethiopie ; l'empire ethiopien et la dynastie salomonide ; les cites-Etats swahilies de la cote, Kilwa, Zanzibar, Lamu, Mombasa ; les peuples pasteurs Maasai du Kenya et de Tanzanie",
    cosmogonie:
      "Enkai, etre supreme de la cosmogonie maasai, associe au ciel et a la pluie ; la tradition chretienne orthodoxe ethiopienne, l'une des plus anciennes formes de christianisme au monde ; la cosmogonie swahilie, rencontre ancienne entre l'islam et les traditions africaines de l'interieur",
    pratiques:
      "la ceremonie du cafe ethiopienne, rituel social et spirituel de partage ; le systeme des classes d'age chez les Maasai, ou chaque generation de jeunes hommes traverse ensemble les memes etapes de la vie guerriere ; la poesie chantee swahilie, l'utenzi",
    valeurs:
      "le courage pastoral et la protection du troupeau, fondement de l'identite guerriere maasai ; l'hospitalite et le sens du commerce cosmopolite des cites swahilies ; la strategie et la determination, illustrees par l'imperatrice Taytu Betul d'Ethiopie",
    contes:
      "l'exil du prince injustement ecarte, l'epreuve de la vie sauvage qui forge le futur souverain, le retour et la reconnaissance par le peuple, motif central de l'epopee de Fumo Liyongo, guerrier-poete swahili legendaire ; les contes du lievre ruse",
  },
  australe: {
    region: "australe",
    zone: "Afrique du Sud, Zimbabwe et les terres voisines",
    royaumes:
      "le royaume de Mapungubwe, fonde par les peuples Venda et Kalanga ; le royaume du Zimbabwe et sa capitale de pierre, le Grand Zimbabwe, peuple Shona ; le royaume zoulou, fonde sous Shaka Zulu",
    cosmogonie:
      "uNkulunkulu, etre supreme et createur de la cosmogonie zouloue et nguni ; les amadlozi, esprits ancestraux qui restent en lien actif avec les vivants et qu'on honore regulierement",
    pratiques:
      "la poesie de louange, izibongo, art oratoire zoulou qui celebre les exploits d'un chef, d'un guerrier ou d'un ancetre ; le perlage zoulou, dont les couleurs et motifs portent des messages codifies ; la divination par les os, pratiquee par les sangoma",
    valeurs:
      "l'ubuntu, principe philosophique fondamental de la region, je suis parce que nous sommes ; le courage guerrier, central dans l'identite zouloue ; la sagesse diplomatique, illustree par Moshoeshoe Ier, fondateur de la nation basotho, qui protegea son peuple par l'alliance strategique plutot que par la seule force",
    contes:
      "l'epreuve de la montagne ou du refuge imprenable, la ruse qui dejoue un ennemi plus fort, la construction d'un peuple a partir de fragments disperses ; les izibongo, poemes de louange transmis et amplifies au fil des generations ; les contes du chacal et du lievre ruse",
  },
};

// Un seul peuple par archetype (cf. totem-v3-pipeline.ts, `archetypes`) : le
// mapping suit ce peuple, pas l'animal seul. Aucun de nos 12 archetypes ne
// releve d'Afrique centrale pour l'instant ; la fiche reste en reserve,
// comme la Serie 7 de la Banque D (cauris) qui n'a pas non plus d'animal
// correspondant.
export const CULTURE_REGION_BY_ARCHETYPE: Record<string, CultureRegion> = {
  lion: "ouest", // Yoruba, Nigeria
  lionne: "est", // Maasai, Kenya / Tanzanie
  rhinoceros: "australe", // Zulu, Afrique du Sud
  crocodile: "ouest", // Mande, Mali / Guinee
  serpent: "ouest", // Fon, Benin
  dauphin: "ouest", // Serer, Senegal
  elephant: "ouest", // Akan, Ghana
  baobab: "ouest", // Wolof, Senegal
  zebre: "australe", // Ndebele, Afrique du Sud
  perroquet: "ouest", // Ashanti, Ghana
  aigle: "ouest", // Dogon, Mali
  leopard: "ouest", // Yoruba, Nigeria
};

export function cultureFicheForArchetype(archetypeId: string): CultureFiche {
  const region = CULTURE_REGION_BY_ARCHETYPE[archetypeId] ?? "ouest";
  return CULTURE_FICHES[region];
}
