# Projects: the Default Project is made, and the datasets made before projects are moved into it

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models

DEFAULT_PROJECT_NAME = "Default Project"


def into_default_project(apps, schema_editor):
    Project = apps.get_model('analyzer', 'Project')
    ThermalDataset = apps.get_model('analyzer', 'ThermalDataset')
    project = Project.objects.order_by('created_at', 'id').first() or Project.objects.create(name=DEFAULT_PROJECT_NAME)
    ThermalDataset.objects.filter(project__isnull=True).update(project=project)


class Migration(migrations.Migration):

    dependencies = [
        ('analyzer', '0002_newest_first_by_id'),
    ]

    operations = [
        migrations.CreateModel(
            name='Project',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='A label used to describe the project', max_length=255, verbose_name='Name')),
                ('description', models.TextField(blank=True, default='', help_text='What the project is about', verbose_name='Description')),
                ('location_lon', models.FloatField(blank=True, help_text='Where the site is: its longitude', null=True, verbose_name='Longitude')),
                ('location_lat', models.FloatField(blank=True, help_text='Where the site is: its latitude', null=True, verbose_name='Latitude')),
                ('location_label', models.CharField(blank=True, default='', help_text="The site's address or place name", max_length=255, verbose_name='Location')),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now, help_text='Creation date', verbose_name='Created at')),
                ('updated_at', models.DateTimeField(auto_now=True, help_text='Last modified date', verbose_name='Updated at')),
            ],
            options={
                'verbose_name': 'Project',
                'verbose_name_plural': 'Projects',
                'ordering': ('created_at', 'id'),
            },
        ),
        migrations.AddField(
            model_name='thermaldataset',
            name='project',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='datasets',
                                    to='analyzer.project'),
        ),
        migrations.RunPython(into_default_project, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='thermaldataset',
            name='project',
            field=models.ForeignKey(help_text='The project the dataset is in', on_delete=django.db.models.deletion.CASCADE,
                                    related_name='datasets', to='analyzer.project', verbose_name='Project'),
        ),
    ]
