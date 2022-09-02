import argparse
from pathlib import Path
import urllib.parse
import shutil


def generate(
    tenant_id: str, scorm_id: str, domain: str, version: str, output_file: Path= None
):
    if not output_file:
        output_file = Path() / 'out' / f"{tenant_id}_{scorm_id}.zip"

    template_folder = Path() / "proxy_templates" / f"v{version}"
    cfg_file = template_folder / "configuration.js"

    cfg_contents = cfg_file.read_text()
    replaced_cfg = (
        cfg_contents.replace("{TENANT}", urllib.parse.quote(tenant_id))
        .replace("{RESOURCE_ID}", urllib.parse.quote(scorm_id))
        .replace("{LAUNCHER_DOMAIN}", domain)
    )
    output_dir = output_file.parent

    temp_dir = output_dir / "tmp"

    shutil.copytree(template_folder, temp_dir)

    out_cfg = temp_dir / "configuration.js"
    out_cfg.write_text(replaced_cfg)

    shutil.make_archive(str(output_file.resolve()), "zip", temp_dir)
    shutil.rmtree(temp_dir)


def run():
    parser = argparse.ArgumentParser(
        description="Generates a SCORM proxy package for FC Connect"
    )
    parser.add_argument("tenant", type=str, help="The tenant identifier")
    parser.add_argument("scorm_id", type=str, help="The scorm identifier")
    parser.add_argument(
        "--out",
        type=str,
        help="The proxy SCORM output file path. Defaults to ./out/{tenant}_{scorm}.zip",
    )
    parser.add_argument(
        "--launcher-domain",
        type=str,
        default="https://0.0.0.0",
        help="The launcher domain",
    )
    parser.add_argument(
        "--template-version", type=str, default="1", help="The template version to use"
    )
    args = parser.parse_args()

    generate(
        tenant_id=args.tenant,
        scorm_id=args.scorm_id,
        output_file=Path(args.out) if args.out else None,
        domain=args.launcher_domain,
        version=args.template_version,
    )


if __name__ == "__main__":
    run()
