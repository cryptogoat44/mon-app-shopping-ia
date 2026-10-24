// Détection des visages et des personnes sur des images, sur le Mac, sans
// réseau (Vision d'Apple). Utilisé par l'outil de la série de mesure : aucune
// image envoyée à SerpApi ne doit montrer un visage, et les planches ne
// montrent aucune personne (décisions du fondateur). N'affiche que des nombres.
//
//   visages <image> [<image>…]  →  une ligne par image : « <index> <visages> <personnes> »
import Foundation
import Vision

for (index, chemin) in CommandLine.arguments.dropFirst().enumerated() {
  let url = URL(fileURLWithPath: chemin)
  let visages = VNDetectFaceRectanglesRequest()
  let personnes = VNDetectHumanRectanglesRequest()
  personnes.upperBodyOnly = false
  let analyse = VNImageRequestHandler(url: url, options: [:])
  do {
    try analyse.perform([visages, personnes])
    print("\(index) \(visages.results?.count ?? 0) \(personnes.results?.count ?? 0)")
  } catch {
    print("\(index) erreur erreur")
  }
}
