param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDir,

  [Parameter(Mandatory = $true)]
  [string]$OutputDir
)

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies "System.Drawing.dll" -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class PrimeTimeSharpener
{
    public static void Sharpen(string sourcePath, string outputPath)
    {
        using (var sourceImage = Image.FromFile(sourcePath))
        using (var source = new Bitmap(sourceImage))
        using (var output = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb))
        {
            source.SetResolution(500, 500);
            output.SetResolution(500, 500);

            var rect = new Rectangle(0, 0, source.Width, source.Height);
            var srcData = source.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            var outData = output.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);

            try
            {
                int bytes = Math.Abs(srcData.Stride) * source.Height;
                byte[] src = new byte[bytes];
                byte[] dst = new byte[bytes];
                Marshal.Copy(srcData.Scan0, src, 0, bytes);

                for (int y = 0; y < source.Height; y++)
                {
                    int row = y * srcData.Stride;
                    int up = Math.Max(0, y - 1) * srcData.Stride;
                    int down = Math.Min(source.Height - 1, y + 1) * srcData.Stride;

                    for (int x = 0; x < source.Width; x++)
                    {
                        int leftX = Math.Max(0, x - 1);
                        int rightX = Math.Min(source.Width - 1, x + 1);
                        int i = row + (x * 4);
                        int left = row + (leftX * 4);
                        int right = row + (rightX * 4);
                        int above = up + (x * 4);
                        int below = down + (x * 4);

                        dst[i] = Adjust((5 * src[i]) - src[left] - src[right] - src[above] - src[below]);
                        dst[i + 1] = Adjust((5 * src[i + 1]) - src[left + 1] - src[right + 1] - src[above + 1] - src[below + 1]);
                        dst[i + 2] = Adjust((5 * src[i + 2]) - src[left + 2] - src[right + 2] - src[above + 2] - src[below + 2]);
                        dst[i + 3] = src[i + 3];
                    }
                }

                Marshal.Copy(dst, 0, outData.Scan0, bytes);
            }
            finally
            {
                source.UnlockBits(srcData);
                output.UnlockBits(outData);
            }

            output.Save(outputPath, ImageFormat.Png);
        }
    }

    private static byte Adjust(int value)
    {
        double contrast = ((value - 128) * 1.06) + 128;
        if (contrast < 0) return 0;
        if (contrast > 255) return 255;
        return (byte)Math.Round(contrast);
    }
}
"@

if (-not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$targets = @(
  @{ Source = "1.2.3.png"; Output = "1.2.3-crisp-500dpi.png" },
  @{ Source = "1.2.4.png"; Output = "1.2.4-crisp-500dpi.png" },
  @{ Source = "common_misconceptions_500dpi.png"; Output = "common_misconceptions-crisp-500dpi.png" },
  @{ Source = "summary-page-500dpi.png"; Output = "summary-page-crisp-500dpi.png" },
  @{ Source = "homework_page_500dpi.png"; Output = "homework_page-crisp-500dpi.png" },
  @{ Source = "advanced_homework_500dpi.png"; Output = "advanced_homework-crisp-500dpi.png" },
  @{ Source = "entrance_ticket_answer_key_500dpi.png"; Output = "entrance_ticket_answer_key-crisp-500dpi.png" },
  @{ Source = "1.1.2-key.png"; Output = "1.1.2-key-crisp-500dpi.png" },
  @{ Source = "1.2.3-answer.png"; Output = "1.2.3-answer-crisp-500dpi.png" },
  @{ Source = "1.2.4-answer.png"; Output = "1.2.4-answer-crisp-500dpi.png" },
  @{ Source = "common_misconceptions_answer_key_500dpi.png"; Output = "common_misconceptions_answer_key-crisp-500dpi.png" },
  @{ Source = "homework_answer_key_500dpi.png"; Output = "homework_answer_key-crisp-500dpi.png" },
  @{ Source = "advanced_homework_answer_key_500dpi.png"; Output = "advanced_homework_answer_key-crisp-500dpi.png" }
)

foreach ($target in $targets) {
  $sourcePath = Join-Path $SourceDir $target.Source
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    $sourcePath = Join-Path (Split-Path -Parent $SourceDir) $target.Source
  }
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    Write-Warning "Missing source: $sourcePath"
    continue
  }

  $outPath = Join-Path $OutputDir $target.Output
  [PrimeTimeSharpener]::Sharpen($sourcePath, $outPath)
  Write-Output $outPath
}
