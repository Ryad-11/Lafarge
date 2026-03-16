const express = require('express');
const cors = require('cors');
const path = require('path');
const stringSimilarity = require('string-similarity');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ════════════════════════════════════════════════════
// 1. SERVE THE WEBSITE
// ════════════════════════════════════════════════════
// This tells the server to allow access to files in this folder (like your logo image)
app.use(express.static(__dirname));

// This tells the server: "When someone visits the home page, send them index.html"
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ════════════════════════════════════════════════════
// 2. SECURE API ROUTES (The Vault)
// ════════════════════════════════════════════════════

// Proxy for Autocomplete
app.get('/api/autocomplete', async (req, res) => {
    try {
        const { text } = req.query;
        const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&limit=6&countrycodes=dz,ma,tn,ly,ne,ml,mr&apiKey=${process.env.GEO_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Autocomplete failed" });
    }
});

// Proxy for Map Clicks (Reverse Geocode)
app.get('/api/reverse', async (req, res) => {
    try {
        const { lat, lon } = req.query;
        const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${process.env.GEO_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Reverse geocode failed" });
    }
});

// Proxy for Routes
app.get('/api/route/geo', async (req, res) => {
    try {
        const { waypoints } = req.query;
        const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&apiKey=${process.env.GEO_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) { res.status(500).json({ error: "Geo routing failed" }); }
});

app.get('/api/route/tom', async (req, res) => {
    try {
        const { lat1, lng1, lat2, lng2 } = req.query;
        const url = `https://api.tomtom.com/routing/1/calculateRoute/${lat1},${lng1}:${lat2},${lng2}/json?key=${process.env.TOMTOM_KEY}&travelMode=truck&vehicleCommercial=true&traffic=true`;
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) { res.status(500).json({ error: "TomTom routing failed" }); }
});

// Proxy for the Google Apps Script Calculator
app.post('/api/cost', async (req, res) => {
    try {
        const { entity, truck, condi, km } = req.body;
        const kmFormatted = String(km).replace('.', ',');
        const url = `${process.env.APPS_SCRIPT_URL}?entity=${encodeURIComponent(entity)}&truck=${encodeURIComponent(truck)}&condi=${encodeURIComponent(condi)}&km=${encodeURIComponent(kmFormatted)}`;
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Cost calc failed" });
    }
});
const multer = require('multer');
const xlsx = require('xlsx');

// Configuration pour garder le fichier Excel temporairement dans la RAM
const upload = multer({ storage: multer.memoryStorage() });

// Fonction pour nettoyer le texte (enlève les accents, majuscules, espaces)
function cleanText(text) {
    if (!text) return "";
    return String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

// Fonction pour calculer la médiane
function getMedian(values) {
    if (values.length === 0) return 0;
    values.sort((a, b) => a - b);
    const half = Math.floor(values.length / 2);
    if (values.length % 2) return values[half];
    return (values[half - 1] + values[half]) / 2.0;
}
// Fonction pour trouver la valeur la plus fréquente (Mode)
function getMode(array) {
    if (array.length === 0) return 0;
    const frequency = {};
    let maxFreq = 0;
    let mode = array[0];

    for (const item of array) {
        frequency[item] = (frequency[item] || 0) + 1;
        if (frequency[item] > maxFreq) {
            maxFreq = frequency[item];
            mode = item;
        }
    }
    return mode;
}

// ROUTE API : Upload du fichier et calcul des statistiques
app.post('/api/stats', upload.single('excelFile'), (req, res) => {
    if (!req.file) return res.json({ found: false, error: "Aucun fichier fourni" });

    try {
        // 1. LECTURE EXCEL
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        // 2. PARAMÈTRES ET NETTOYAGE
        const { entity, condi, geoCity, geoWilaya } = req.body;

        const entityMap = { "CILAS": "Usine Biskra", "LCM": "Usine M'sila", "LCO": "Usine Oggaz" };
        const targetSite = cleanText(entityMap[entity]);
        const targetCondi = cleanText(condi);
        const targetCity = cleanText(geoCity);
        let targetWilaya = cleanText(geoWilaya);

        // Alias manuel pour la capitale au cas où (sécurité supplémentaire)
        if (targetWilaya === "algiers") targetWilaya = "alger";

        // 3. FILTRE DE BASE (Usine + Produit)
        let baseMatches = excelData.filter(row =>
            cleanText(row['site_chargement']) === targetSite &&
            cleanText(row['conditionnement']) === targetCondi
        );

        let wilayaMatches = [];
        let finalRows = [];
        let precision = "Aucune facture trouvée";

        // --- LA NOUVEAUTÉ : L'ENTONNOIR DE SIMILARITÉ ---

        // ÉTAPE A : FUZZY MATCHING SUR LA WILAYA (Seuil: 55%)
        if (targetWilaya !== "" && baseMatches.length > 0) {
            const wilayasExcel = [...new Set(baseMatches.map(row => cleanText(row['wilaya'])))].filter(w => w !== "");

            if (wilayasExcel.length > 0) {
                const bestW = stringSimilarity.findBestMatch(targetWilaya, wilayasExcel).bestMatch;
                if (bestW.rating >= 0.55) {
                    const matchedWilaya = bestW.target;
                    wilayaMatches = baseMatches.filter(row => cleanText(row['wilaya']) === matchedWilaya);
                    precision = `Moyenne Wilaya (${matchedWilaya})`;
                    console.log(`📍 Wilaya validée : ${targetWilaya} -> ${matchedWilaya} (${Math.round(bestW.rating * 100)}%)`);
                } else {
                    console.log(`❌ Wilaya "${targetWilaya}" rejetée (Meilleur: ${bestW.target} à ${Math.round(bestW.rating * 100)}%)`);
                }
            }
        }

        // ÉTAPE B : FUZZY MATCHING SUR LA VILLE (Seuil: 50%)
        if (wilayaMatches.length > 0 && targetCity !== "") {
            const villesDansWilaya = [...new Set(wilayaMatches.map(row => cleanText(row['ville'])))].filter(v => v !== "");

            if (villesDansWilaya.length > 0) {
                const bestCityMatch = stringSimilarity.findBestMatch(targetCity, villesDansWilaya).bestMatch;
                if (bestCityMatch.rating >= 0.50) {
                    const matchedCity = bestCityMatch.target;
                    finalRows = wilayaMatches.filter(row => cleanText(row['ville']) === matchedCity);
                    precision = `Ville exacte : ${matchedCity}`;
                    console.log(`🎯 Ville validée : ${targetCity} -> ${matchedCity} (${Math.round(bestCityMatch.rating * 100)}%)`);
                } else {
                    finalRows = wilayaMatches;
                    console.log(`⚠️ Ville "${targetCity}" trop différente. On garde la wilaya.`);
                }
            } else {
                finalRows = wilayaMatches;
            }
        } else if (wilayaMatches.length > 0) {
            finalRows = wilayaMatches;
        }

        // -------------------------------------------------

        // 4. EXTRAIRE LES COÛTS ET STOCKER TOUS LES KM
        let totalCost = 0;
        let costs = [];
        let allKms = []; // On crée une liste pour stocker tous les kilométrages

        finalRows.forEach(row => {
            const cost = Number(row['cout_par_unite']);

            let km = 0;
            for (let key in row) {
                let cleanKey = String(key).toLowerCase().trim();
                // We use strict equality (===) to ignore "tranche_distance"
                if (cleanKey === 'km' || cleanKey === 'distance') {
                    let valStr = String(row[key]).replace(',', '.').replace(/[^0-9.]/g, '');
                    km = Number(valStr);
                    break;
                }
            }

            if (!isNaN(cost) && cost > 0) {
                costs.push(cost);
                totalCost += cost;

                // Si le KM est valide (supérieur à 0), on le met dans la liste
                // We round the KM so the Mode function can group them properly!
                if (!isNaN(km) && km > 0) {
                    allKms.push(Math.round(km));
                }
            }
        });
        console.log("=== DEBUG DISTANCES ===");
        console.log("Rows found for this city:", finalRows.length);
        console.log("Exact list of all extracted KMs:", allKms);
        console.log("The chosen Mode (Frequent KM) is:", getMode(allKms));
        console.log("=======================");
        if (costs.length === 0) return res.json({ found: false });


        // 5. ENVOI DES RÉSULTATS (Avec le KM le plus fréquent !)
        res.json({
            found: true,
            precision: precision,
            count: costs.length,
            max: Math.max(...costs),
            min: Math.min(...costs),
            avg: totalCost / costs.length,
            frequentKm: getMode(allKms), // On utilise notre nouvelle fonction ici
            median: getMedian(costs)
        });

    } catch (error) {
        console.error("Erreur Excel:", error);
        res.status(500).json({ found: false, error: "Erreur serveur" });
    }
});


// ════════════════════════════════════════════════════
// 3. START SERVER
// ════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur sécurisé démarré sur le port ${PORT}`));