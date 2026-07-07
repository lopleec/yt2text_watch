param(
  [Parameter(Mandatory = $true)]
  [string]$AudioPath,

  [string]$Language = "zh-CN"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Speech

$cultureName = if ([string]::IsNullOrWhiteSpace($Language) -or $Language -eq "auto") { [System.Globalization.CultureInfo]::CurrentCulture.Name } else { $Language }
$culture = [System.Globalization.CultureInfo]::GetCultureInfo($cultureName)
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)

try {
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToWaveFile($AudioPath)
  $segments = New-Object System.Collections.Generic.List[object]

  while ($true) {
    $result = $engine.Recognize()
    if ($null -eq $result) {
      break
    }

    foreach ($word in $result.Words) {
      $segments.Add([pscustomobject]@{
        start = $word.AudioPosition.TotalSeconds
        end = ($word.AudioPosition + $word.AudioDuration).TotalSeconds
        text = $word.Text
        confidence = $word.Confidence
      })
    }
  }

  [pscustomobject]@{
    engine = "windows-sapi"
    language = $culture.Name
    segments = $segments
  } | ConvertTo-Json -Depth 6 -Compress
} finally {
  $engine.Dispose()
}
