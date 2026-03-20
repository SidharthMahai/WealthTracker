import Foundation
import PDFKit

let arguments = CommandLine.arguments.dropFirst()
guard let path = arguments.first else {
    fputs("Usage: swift extract_pdf_text.swift <pdf-path>\n", stderr)
    exit(1)
}

guard let pdf = PDFDocument(url: URL(fileURLWithPath: path)) else {
    fputs("Unable to open PDF at \(path)\n", stderr)
    exit(1)
}

print(pdf.string ?? "")
