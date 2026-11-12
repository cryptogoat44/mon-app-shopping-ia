// Recherche d'image d'iOS (« Visual Intelligence », iOS 26 et suivants) —
// mission « liens vidéo », étape 7.
//
// Parcours : dans n'importe quelle app, la personne fait une capture d'écran,
// touche « Recherche d'image », puis choisit l'app dans les résultats.
//   1. iOS appelle `values(for:)` ci-dessous avec l'image de la capture.
//   2. L'image est rangée, en JPEG de 1 600 px au plus (qualité 0,8), dans le
//      dossier du groupe d'apps. AUCUN appel réseau ici : iOS attend une
//      réponse rapide.
//   3. Un seul résultat est rendu : « Trouver cette pièce avec <nom de
//      l'app> », avec la vignette de la capture.
//   4. Quand la personne le touche, iOS lance `perform()` : l'app s'ouvre sur
//      le lien « <schéma>://recherche-image?fichier=<identifiant> ».
//      L'app lit le fichier, lance sa recherche habituelle, puis l'efface
//      (apps/mobile/src/lib/visual-search-intake.ts).
// Une capture jamais ouverte est effacée au bout d'une heure (au passage
// suivant). Rien n'est gardé ailleurs, rien n'est envoyé d'ici.
//
// Ce fichier est ajouté à la cible principale de l'app par le plugin
// apps/mobile/plugins/recherche-image.js (le dossier ios/ est généré à chaque
// compilation). Le groupe d'apps et le schéma des liens sont lus dans
// Info.plist (clés SpottoAppGroup et SpottoScheme, écrites par le plugin à
// partir du fichier unique de la marque) : rien n'est figé ici.
//
// Sans effet sur un iPhone d'avant iOS 26 (`@available`), ni si l'app est
// compilée avec un Xcode qui ne connaît pas VisualIntelligence (`canImport`).
// Les étiquettes (`labels`) fournies par iOS ne servent pas : elles sont
// souvent vides, et en anglais seulement.
//
// ⚠️ Écrit d'après la documentation d'Apple (« Integrating your app with
// visual intelligence », SemanticContentDescriptor, IntentValueQuery,
// OpenIntent), sans avoir pu être compilé : à compiler puis à essayer sur un
// iPhone compatible (voir docs/liens-video/tests-manuels.md).

import AppIntents
import CoreImage
import Foundation
import UIKit

#if canImport(VisualIntelligence)
import VisualIntelligence

/// Rangement des captures reçues, dans le dossier du groupe d'apps.
@available(iOS 26.0, *)
enum SpottoCaptures {
  /// Dossier des captures, dans le conteneur du groupe d'apps.
  static let folder = "recherche-image"
  /// Lien d'ouverture en attente, relu par l'app si iOS ne l'a pas transmis.
  static let pendingFile = "recherche-image-en-attente.txt"
  /// Plus grand côté de l'image rangée, en pixels.
  static let maxSide: CGFloat = 1600
  /// Qualité du JPEG rangé.
  static let quality: CGFloat = 0.8
  /// Une capture jamais ouverte est effacée au bout d'une heure.
  static let maxAge: TimeInterval = 3600

  static var appGroup: String? { Bundle.main.object(forInfoDictionaryKey: "SpottoAppGroup") as? String }
  static var scheme: String? { Bundle.main.object(forInfoDictionaryKey: "SpottoScheme") as? String }
  static var appName: String {
    (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
      ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String)
      ?? ""
  }
  static var french: Bool { (Locale.preferredLanguages.first ?? "").hasPrefix("fr") }

  /// Texte du résultat montré par iOS.
  static var title: LocalizedStringResource {
    let text = french ? "Trouver cette pièce avec \(appName)" : "Find this piece with \(appName)"
    return LocalizedStringResource(String.LocalizationValue(text))
  }

  static var container: URL? {
    guard let appGroup else { return nil }
    return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  }

  static var directory: URL? {
    guard let container else { return nil }
    let url = container.appendingPathComponent(folder, isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  /// Fichier d'une capture ; l'identifiant est toujours un UUID (jamais un chemin).
  static func fileURL(_ id: String) -> URL? {
    guard UUID(uuidString: id) != nil, let directory else { return nil }
    return directory.appendingPathComponent("\(id.lowercased()).jpg")
  }

  static func exists(_ id: String) -> Bool {
    guard let url = fileURL(id) else { return false }
    return FileManager.default.fileExists(atPath: url.path)
  }

  /// Efface les captures de plus d'une heure, jamais ouvertes.
  static func purge() {
    guard let directory,
          let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])
    else { return }
    let limit = Date().addingTimeInterval(-maxAge)
    for file in files {
      let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
      if let modified, modified < limit { try? FileManager.default.removeItem(at: file) }
    }
  }

  /// Range l'image de la capture (JPEG, 1 600 px au plus) ; rend son identifiant.
  static func save(_ pixelBuffer: CVReadOnlyPixelBuffer) -> String? {
    purge()
    let image = CIImage(cvPixelBuffer: pixelBuffer)
    let extent = image.extent
    guard extent.width > 0, extent.height > 0 else { return nil }
    let scale = min(1, maxSide / max(extent.width, extent.height))
    let scaled = scale < 1 ? image.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) : image
    let options = [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): quality]
    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let data = CIContext().jpegRepresentation(of: scaled, colorSpace: colorSpace, options: options)
    else { return nil }
    let id = UUID().uuidString.lowercased()
    guard let url = fileURL(id) else { return nil }
    do {
      try data.write(to: url, options: .atomic)
    } catch {
      return nil
    }
    return id
  }

  /// Vignette de la capture, pour le résultat montré par iOS.
  static func thumbnail(_ id: String) -> Data? {
    guard let url = fileURL(id), let image = UIImage(contentsOfFile: url.path) else { return nil }
    let side: CGFloat = 320
    let ratio = min(1, side / max(image.size.width, image.size.height))
    let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
    return (image.preparingThumbnail(of: size) ?? image).jpegData(compressionQuality: 0.7)
  }

  /// Lien qui ouvre l'app sur cette capture.
  static func openURL(_ id: String) -> URL? {
    guard let scheme, UUID(uuidString: id) != nil else { return nil }
    return URL(string: "\(scheme)://recherche-image?fichier=\(id.lowercased())")
  }

  /// Note le lien d'ouverture : l'app le relit à son réveil si iOS ne le lui a pas transmis.
  static func notePending(_ url: URL) {
    guard let container else { return }
    try? url.absoluteString.write(to: container.appendingPathComponent(pendingFile), atomically: true, encoding: .utf8)
  }
}

/// Le résultat montré par iOS : la capture, à chercher dans l'app.
@available(iOS 26.0, *)
struct SpottoCaptureEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: LocalizedStringResource(String.LocalizationValue(SpottoCaptures.french ? "Pièce" : "Piece")))
  }

  static let defaultQuery = SpottoCaptureEntityQuery()

  /// Identifiant du fichier de la capture (un UUID).
  var id: String

  var displayRepresentation: DisplayRepresentation {
    let image = SpottoCaptures.thumbnail(id).map { DisplayRepresentation.Image(data: $0) }
    return DisplayRepresentation(title: SpottoCaptures.title, subtitle: nil, image: image)
  }
}

/// Retrouve une capture par son identifiant (demandé par iOS au moment d'ouvrir).
@available(iOS 26.0, *)
struct SpottoCaptureEntityQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [SpottoCaptureEntity] {
    identifiers.filter { SpottoCaptures.exists($0) }.map { SpottoCaptureEntity(id: $0) }
  }

  func suggestedEntities() async throws -> [SpottoCaptureEntity] {
    []
  }
}

/// Appelée par iOS avec l'image de la capture : un seul résultat, sans aucun appel réseau.
@available(iOS 26.0, *)
struct SpottoVisualSearchQuery: IntentValueQuery {
  func values(for input: SemanticContentDescriptor) async throws -> [SpottoCaptureEntity] {
    guard let pixelBuffer = input.pixelBuffer, let id = SpottoCaptures.save(pixelBuffer) else {
      return []
    }
    return [SpottoCaptureEntity(id: id)]
  }
}

/// Ouvre l'app sur la capture choisie : elle lance sa recherche habituelle.
@available(iOS 26.0, *)
struct OpenSpottoCaptureIntent: OpenIntent {
  static let title: LocalizedStringResource = "Find this piece"

  @Parameter(title: "Image")
  var target: SpottoCaptureEntity

  @MainActor
  func perform() async throws -> some IntentResult {
    if let url = SpottoCaptures.openURL(target.id) {
      SpottoCaptures.notePending(url)
      _ = await UIApplication.shared.open(url)
    }
    return .result()
  }
}
#endif
